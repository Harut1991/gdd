import { Agent, CursorAgentError, type Run, type SDKMessage } from "@cursor/sdk";
import { emptyGddRows, extractJsonPayload, mergeAgentPayload } from "./gddSchema.js";
import { ensureMediaDirs, scanMedia } from "./media.js";
import { buildExtractionPrompt } from "./prompt.js";
import { appendEvent, loadRun, saveRun } from "./store.js";
import { PLAYBOOK_STEPS, type ProgressEvent, type RunRecord } from "./types.js";

interface ActiveHandle {
  abortRequested: boolean;
  agentRun?: Run;
  /** relative media paths already announced in the log */
  announcedMedia: Set<string>;
  /** last progress message to suppress duplicates */
  lastLogMessage?: string;
}

const activeRuns = new Map<string, ActiveHandle>();

export async function stopRun(runId: string): Promise<{ ok: boolean; message: string }> {
  const run = await loadRun(runId);
  if (!run) return { ok: false, message: "Run not found" };
  if (run.status !== "queued" && run.status !== "running") {
    return { ok: false, message: `Run already ${run.status}` };
  }

  let handle = activeRuns.get(runId);
  if (!handle) {
    handle = { abortRequested: true, announcedMedia: new Set() };
    activeRuns.set(runId, handle);
  } else {
    handle.abortRequested = true;
  }

  if (handle.agentRun?.supports("cancel")) {
    try {
      await handle.agentRun.cancel();
    } catch (err) {
      console.error("cancel failed", err);
    }
  }

  run.status = "cancelled";
  run.error = "Stopped by user";
  run.currentActivity = "Stopped";
  run.media = await scanMedia(run);
  await saveRun(run);
  await appendEvent(run, "status", "Stop requested — cancelling agent…");
  await appendEvent(run, "done", "Stopped by user");
  return { ok: true, message: "Stop requested" };
}

function isAbortRequested(runId: string): boolean {
  return Boolean(activeRuns.get(runId)?.abortRequested);
}

async function logOnce(
  run: RunRecord,
  type: ProgressEvent["type"],
  message: string,
  step?: string,
): Promise<void> {
  const handle = activeRuns.get(run.id);
  if (handle?.lastLogMessage === message) return;
  if (handle) handle.lastLogMessage = message;
  await appendEvent(run, type, message, step);
}

function requireApiKey(): string {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new Error("CURSOR_API_KEY is missing. Copy .env.example to .env and set your key.");
  }
  return key;
}

function parseModelParams(
  raw: string | undefined,
): Array<{ id: string; value: string }> | undefined {
  const text = raw?.trim();
  if (!text) {
    return [{ id: "fast", value: "true" }];
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const out: Array<{ id: string; value: string }> = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (v == null) continue;
      out.push({ id: k, value: String(v) });
    }
    return out.length ? out : undefined;
  } catch {
    throw new Error(`CURSOR_MODEL_PARAMS must be JSON object, got: ${text}`);
  }
}

function clip(text: string, max = 280): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;

  // Nested MCP wrapper: { toolName, args } or { providerIdentifier, toolName, args }
  if (typeof a.toolName === "string") {
    const inner = summarizeArgs(a.args);
    return inner ? `${a.toolName} · ${inner}` : String(a.toolName);
  }

  const bits: string[] = [];
  for (const key of ["url", "element", "ref", "selector", "path", "filename", "text", "action", "time", "index"]) {
    if (a[key] != null && String(a[key]).trim()) {
      let val = String(a[key]);
      // shorten absolute media paths
      val = val.replace(/\/var\/www\/gdd\/server\/runs\/[^/]+\/media\//, "media/");
      bits.push(`${key}=${clip(val, 60)}`);
    }
  }
  return bits.join(" ");
}

function unwrapToolName(event: { name?: string; args?: unknown }): string {
  const args = event.args;
  if (args && typeof args === "object" && typeof (args as { toolName?: string }).toolName === "string") {
    return (args as { toolName: string }).toolName;
  }
  return event.name || "tool";
}

const NOISY_TOOLS = new Set([
  "browser_wait_for",
  "browser_network_request",
  "browser_network_requests",
  "read",
  "Read",
]);

const STEP_IDS = new Set(PLAYBOOK_STEPS.map((s) => s.id));

function parseProgressLines(
  text: string,
): Array<{ step?: string; message: string }> {
  const out: Array<{ step?: string; message: string }> = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*PROGRESS:\s*([a-z0-9_]+)\s*[—\-–:]?\s*(.*)$/i);
    if (m) {
      const step = m[1].toLowerCase();
      const note = m[2].trim();
      const label = PLAYBOOK_STEPS.find((s) => s.id === step)?.label;
      out.push({
        step: STEP_IDS.has(step as never) ? step : undefined,
        message: label
          ? `${label}${note ? ` — ${note}` : ""}`
          : clip(line.replace(/^\s*PROGRESS:\s*/i, ""), 200),
      });
    }
  }
  return out;
}

function inferStepFromTool(name: string, args: unknown): string | undefined {
  const n = name.toLowerCase();
  const argStr = summarizeArgs(args).toLowerCase();
  if (n.includes("navigate") || argStr.includes("http")) return "open_demo";
  if (n.includes("network")) return "capture_apis";
  if (n.includes("screenshot") || n.includes("snapshot")) {
    if (argStr.includes("win")) return "capture_win";
    if (argStr.includes("symbol") || argStr.includes("reel")) return "capture_symbols";
    return "reach_game";
  }
  if (n.includes("click") || n.includes("type") || n.includes("fill") || n.includes("mouse")) {
    if (/spin|play|hold/.test(argStr)) return "find_spin";
    if (/setting|menu|bet|cog|option|paytable|language|lang/.test(argStr)) return "decide";
    if (/ok|close|accept|dismiss|reload|continue/.test(argStr)) return "reach_game";
    return "decide";
  }
  if (n.includes("resize") || n.includes("tab")) return "reach_game";
  if (n.includes("evaluate") || n.includes("run_code")) return "detect_tech";
  return undefined;
}

function summarizeSdkMessage(
  event: SDKMessage,
): { type: ProgressEvent["type"]; message: string; step?: string } | null {
  switch (event.type) {
    case "tool_call": {
      // Only log completed tools once — skip "running" to avoid ▶ then ✓ duplication
      if (event.status !== "completed" && event.status !== "error") return null;

      const name = unwrapToolName(event);
      if (NOISY_TOOLS.has(name) || NOISY_TOOLS.has(event.name || "")) return null;

      const detail = summarizeArgs(event.args);
      const shortName = name.replace(/^browser_/, "").replace(/^mcp_?/, "");
      const msg =
        event.status === "error"
          ? `✖ ${shortName}${detail ? ` · ${detail}` : ""}`
          : `✓ ${shortName}${detail ? ` · ${detail}` : ""}`;
      return {
        type: "tool",
        message: msg,
        step: inferStepFromTool(name, event.args),
      };
    }
    case "assistant": {
      const texts = event.message.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean);
      if (!texts.length) return null;
      const joined = texts.join("\n");
      const progress = parseProgressLines(joined);
      if (progress.length) {
        return {
          type: "step",
          message: progress[0].message,
          step: progress[0].step,
        };
      }
      if (/^\s*\{/.test(joined) && joined.includes('"fields"')) {
        return { type: "status", message: "Drafting GDD JSON…" };
      }
      if (joined.length < 40 || /^[\s\}\]\`,\.]+$/.test(joined)) {
        return null;
      }
      // Prefer PROGRESS lines only in the live log — skip long assistant chatter
      return null;
    }
    case "status": {
      if (event.status === "RUNNING" || event.status === "CREATING") return null;
      const extra = event.message ? `: ${event.message}` : "";
      return { type: "status", message: `Agent ${event.status}${extra}` };
    }
    case "task": {
      if (!event.text && !event.status) return null;
      return {
        type: "status",
        message: clip(`Task ${event.status ?? ""} ${event.text ?? ""}`.trim()),
      };
    }
    default:
      return null;
  }
}

function collectAssistantText(event: SDKMessage): string {
  if (event.type !== "assistant") return "";
  return event.message.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function refreshMedia(runId: string): Promise<void> {
  const run = await loadRun(runId);
  if (!run || run.status !== "running") return;
  const handle = activeRuns.get(runId);
  const items = await scanMedia(run);
  run.media = items;

  const fresh: string[] = [];
  for (const item of items) {
    if (!handle) break;
    if (handle.announcedMedia.has(item.relativePath)) continue;
    handle.announcedMedia.add(item.relativePath);
    // live_view is overwritten often — show in media box but don't spam the log
    if (item.relativePath.includes("live_view")) continue;
    fresh.push(`${item.kind}: ${item.relativePath}`);
  }

  await saveRun(run);
  for (const line of fresh) {
    await logOnce(run, "media", `Saved ${line}`);
  }
}

export async function executeRun(runId: string): Promise<void> {
  const run = await loadRun(runId);
  if (!run) return;

  const handle: ActiveHandle = activeRuns.get(runId) ?? {
    abortRequested: false,
    announcedMedia: new Set(),
  };
  if (!handle.announcedMedia) handle.announcedMedia = new Set();
  activeRuns.set(runId, handle);
  if (handle.abortRequested) {
    run.status = "cancelled";
    run.currentActivity = "Stopped";
    await saveRun(run);
    await appendEvent(run, "done", "Stopped by user before start");
    activeRuns.delete(runId);
    return;
  }

  run.status = "running";
  run.media = run.media ?? [];
  run.currentActivity = "Preparing media folders…";
  await saveRun(run);

  const mediaDir = await ensureMediaDirs(run.id);
  await appendEvent(run, "step", "Open demo URL — starting", "open_demo");
  await appendEvent(
    run,
    "status",
    `Media folder ready: runs/${run.id}/media/ (screenshots, symbols, wins, sounds)`,
  );

  const apiKey = requireApiKey();
  const modelId = process.env.CURSOR_MODEL?.trim() || "composer-2";
  const modelParams = parseModelParams(process.env.CURSOR_MODEL_PARAMS);
  const cwd = process.cwd();
  const prompt = buildExtractionPrompt(run.url, mediaDir);

  let assistantText = "";
  let mediaPoll: ReturnType<typeof setInterval> | undefined;

  try {
    if (isAbortRequested(runId)) throw new Error("Stopped by user");

    await appendEvent(run, "status", `Starting Cursor agent (model ${modelId})…`);

    await using agent = await Agent.create({
      apiKey,
      model: { id: modelId, ...(modelParams ? { params: modelParams } : {}) },
      local: {
        cwd,
        // Let Cursor use the user's/project browser & MCP tools — we don't drive a browser ourselves.
        settingSources: ["user", "project", "team"],
      },
    });

    if (isAbortRequested(runId)) throw new Error("Stopped by user");

    run.agentId = agent.agentId;
    await saveRun(run);
    await appendEvent(
      run,
      "status",
      `Agent ready. Asking Cursor to open the demo, gather GDD data, and return JSON.`,
    );

    mediaPoll = setInterval(() => {
      void refreshMedia(run.id).catch(() => undefined);
    }, 4000);

    const agentRun = await agent.send(prompt);
    handle.agentRun = agentRun;
    run.runId = agentRun.id;
    await saveRun(run);
    await appendEvent(run, "step", "Cursor agent working…", "open_demo");

    if (isAbortRequested(runId)) {
      if (agentRun.supports("cancel")) await agentRun.cancel();
      throw new Error("Stopped by user");
    }

    for await (const event of agentRun.stream()) {
      if (isAbortRequested(runId)) {
        if (agentRun.supports("cancel")) await agentRun.cancel();
        break;
      }

      if (event.type === "assistant") {
        const text = collectAssistantText(event);
        assistantText += text;
        const progresses = parseProgressLines(text);
        if (progresses.length) {
          for (const p of progresses) {
            await logOnce(run, "step", p.message, p.step);
          }
          continue;
        }
      }

      const summary = summarizeSdkMessage(event);
      if (summary) {
        await logOnce(run, summary.type, summary.message, summary.step);
      }
    }

    const result = await agentRun.wait();
    if (mediaPoll) clearInterval(mediaPoll);

    // Re-load in case stopRun already marked cancelled
    const latest = (await loadRun(runId)) ?? run;
    if (isAbortRequested(runId) || latest.status === "cancelled" || result.status === "cancelled") {
      latest.status = "cancelled";
      latest.error = "Stopped by user";
      latest.currentActivity = "Stopped";
      latest.media = await scanMedia(latest);
      await saveRun(latest);
      if (!latest.events.some((e) => e.message === "Stopped by user")) {
        await appendEvent(latest, "done", "Stopped by user");
      }
      return;
    }

    if (result.status === "error") {
      run.status = "error";
      run.error = result.error?.message || `Agent run error (${result.id})`;
      run.rows = emptyGddRows(run.url);
      run.media = await scanMedia(run);
      await saveRun(run);
      await appendEvent(run, "error", run.error);
      return;
    }

    await appendEvent(run, "step", "Write GDD JSON — parsing result", "write_gdd");
    const resultText = result.result?.trim() ? result.result : assistantText;
    const payload = extractJsonPayload(resultText || assistantText);
    if (!payload) {
      await appendEvent(
        run,
        "status",
        "No parseable JSON — table left blank except demo URL.",
      );
    } else if (payload.playSummary) {
      const ps = payload.playSummary;
      await appendEvent(
        run,
        "status",
        `Play summary: spins=${ps.spinsAttempted ?? "?"} wins=${ps.winsSeen ?? "?"} settings=${ps.settingsOpened ?? "?"} ${ps.notes ?? ""}`.trim(),
      );
    }

    run.rows = mergeAgentPayload(run.url, payload);
    run.media = await scanMedia(run);
    run.status = "completed";
    run.currentActivity = "Done";
    await saveRun(run);
    const filled = run.rows.filter(
      (r) => r.value && r.parameter !== "Reference Game / URL",
    ).length;
    await appendEvent(
      run,
      "done",
      `Completed. Filled ${filled} field(s), ${run.media.length} media file(s). Unknowns left empty.`,
    );
  } catch (err) {
    if (mediaPoll) clearInterval(mediaPoll);
    const latest = (await loadRun(runId)) ?? run;
    if (isAbortRequested(runId) || (err instanceof Error && err.message === "Stopped by user")) {
      latest.status = "cancelled";
      latest.error = "Stopped by user";
      latest.currentActivity = "Stopped";
      latest.media = await scanMedia(latest);
      await saveRun(latest);
      if (!latest.events.some((e) => e.message === "Stopped by user")) {
        await appendEvent(latest, "done", "Stopped by user");
      }
      return;
    }

    const message =
      err instanceof CursorAgentError
        ? `Startup failed: ${err.message}${err.isRetryable ? " (retryable)" : ""}`
        : err instanceof Error
          ? err.message
          : String(err);

    run.status = "error";
    run.error = message;
    run.currentActivity = "Error";
    if (!run.rows.length) run.rows = emptyGddRows(run.url);
    run.media = await scanMedia(run);
    await saveRun(run);
    await appendEvent(run, "error", message);
  } finally {
    activeRuns.delete(runId);
  }
}
