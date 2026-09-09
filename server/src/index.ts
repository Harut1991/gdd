import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { executeRun, stopRun } from "./agentRunner.js";
import {
  createGameFromRun,
  draftFromRows,
  gameAssetsRoot,
  loadGameConfig,
  prepareDraftAssets,
} from "./createGame.js";
import { emptyGddRows } from "./gddSchema.js";
import { mediaRoot, scanMedia } from "./media.js";
import {
  appendEvent,
  ensureRunsDir,
  listRuns,
  loadRun,
  saveRun,
  subscribe,
} from "./store.js";
import type { RunRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function main() {
  await ensureRunsDir();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasApiKey: Boolean(process.env.CURSOR_API_KEY?.trim()),
      model: process.env.CURSOR_MODEL || "composer-2",
      modelParams: process.env.CURSOR_MODEL_PARAMS || null,
    });
  });

  app.get("/api/runs", async (_req, res) => {
    const runs = await listRuns();
    res.json(
      runs.map((r) => {
        const filled = (r.rows ?? []).filter(
          (row) => row.value?.trim() && row.parameter !== "Reference Game / URL",
        ).length;
        return {
          id: r.id,
          url: r.url,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          error: r.error,
          mediaCount: r.media?.length ?? 0,
          filledCount: filled,
          currentActivity: r.currentActivity,
        };
      }),
    );
  });

  app.get("/api/runs/:id", async (req, res) => {
    const run = await loadRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    // Always refresh media from disk so history loads show current files
    run.media = await scanMedia(run);
    await saveRun(run);
    res.json(run);
  });

  app.use("/api/runs/:id/media", (req, res, next) => {
    const root = mediaRoot(req.params.id);
    return express.static(root, { index: false })(req, res, next);
  });

  app.get("/api/runs/:id/events", async (req, res) => {
    const run = await loadRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ type: "snapshot", run });

    for (const event of run.events) {
      send({ type: "event", event });
    }

    if (run.status === "completed" || run.status === "error" || run.status === "cancelled") {
      send({ type: "finished", status: run.status });
      res.end();
      return;
    }

    const unsubscribe = subscribe(run.id, async (event) => {
      send({ type: "event", event });
      const latest = await loadRun(run.id);
      if (latest) send({ type: "run", run: latest });
      if (
        latest &&
        (latest.status === "completed" ||
          latest.status === "error" ||
          latest.status === "cancelled")
      ) {
        send({ type: "finished", status: latest.status });
        unsubscribe();
        res.end();
      }
    });

    req.on("close", () => {
      unsubscribe();
    });
  });

  app.post("/api/runs", async (req, res) => {
    const url = String(req.body?.url ?? "").trim();
    if (!url || !isValidHttpUrl(url)) {
      res.status(400).json({ error: "Valid http(s) demo URL is required" });
      return;
    }

    if (!process.env.CURSOR_API_KEY?.trim()) {
      res.status(503).json({
        error: "CURSOR_API_KEY not configured. Add it to .env and restart the server.",
      });
      return;
    }

    const now = new Date().toISOString();
    const run: RunRecord = {
      id: uuidv4(),
      url,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      events: [],
      rows: emptyGddRows(url),
      media: [],
      currentActivity: "Queued",
    };

    await saveRun(run);
    await appendEvent(run, "status", `Queued extraction for ${url}`);

    res.status(201).json(run);

    // Fire-and-forget background job
    void executeRun(run.id);
  });

  app.post("/api/runs/:id/stop", async (req, res) => {
    const result = await stopRun(req.params.id);
    if (!result.ok) {
      res.status(result.message === "Run not found" ? 404 : 409).json(result);
      return;
    }
    const run = await loadRun(req.params.id);
    res.json({ ...result, run });
  });

  app.get("/api/runs/:id/game/draft", async (req, res) => {
    const run = await loadRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    try {
      const existing = await loadGameConfig(run.id);
      const assets = await prepareDraftAssets(run.id, run.rows);
      res.json({
        draft: draftFromRows(run.rows),
        existing,
        symbols: assets.symbols,
        sounds: assets.sounds,
        sourceImage: assets.sourceImage,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/runs/:id/create-game", async (req, res) => {
    const run = await loadRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    run.media = await scanMedia(run);
    if (!run.media.length) {
      res.status(400).json({ error: "No media on this run — extract screenshots first" });
      return;
    }
    try {
      const config = await createGameFromRun(run.id, run.rows, req.body ?? {});
      res.json(config);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/api/runs/:id/game", async (req, res) => {
    const config = await loadGameConfig(req.params.id);
    if (!config) {
      res.status(404).json({ error: "Game not created yet" });
      return;
    }
    res.json(config);
  });

  app.use("/api/runs/:id/game", (req, res, next) => {
    const root = gameAssetsRoot(req.params.id);
    return express.static(root, { index: false })(req, res, next);
  });

  const webDist = path.resolve(__dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next();
    });
  });

  app.listen(PORT, () => {
    console.log(`GDD server listening on http://localhost:${PORT}`);
    console.log(
      process.env.CURSOR_API_KEY?.trim()
        ? "CURSOR_API_KEY: set"
        : "CURSOR_API_KEY: MISSING — set in .env before starting a run",
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
