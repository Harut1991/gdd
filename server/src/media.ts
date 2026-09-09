import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { MediaItem, MediaKind, RunRecord } from "./types.js";
import { RUNS_DIR } from "./store.js";

export function mediaRoot(runId: string): string {
  return path.join(RUNS_DIR, runId, "media");
}

export async function ensureMediaDirs(runId: string): Promise<string> {
  const root = mediaRoot(runId);
  for (const sub of ["screenshots", "symbols", "wins", "sounds", "other"]) {
    await mkdir(path.join(root, sub), { recursive: true });
  }
  return root;
}

function kindFromPath(rel: string): MediaKind {
  const lower = rel.toLowerCase();
  if (lower.includes("/symbols/")) return "symbol";
  if (lower.includes("/wins/")) return "win";
  if (lower.includes("/sounds/") || /\.(mp3|ogg|wav|m4a|aac)$/i.test(lower)) {
    return "sound";
  }
  if (lower.includes("/screenshots/") || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    return "screenshot";
  }
  return "other";
}

async function walkFiles(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

export async function scanMedia(run: RunRecord): Promise<MediaItem[]> {
  const root = mediaRoot(run.id);
  const files = await walkFiles(root, root);
  const items: MediaItem[] = [];

  for (const rel of files.sort()) {
    const abs = path.join(root, rel);
    let createdAt = new Date().toISOString();
    try {
      const s = await stat(abs);
      createdAt = s.mtime.toISOString();
    } catch {
      // ignore
    }
    const kind = kindFromPath(rel.replace(/\\/g, "/"));
    const filename = path.basename(rel);
    items.push({
      id: `${run.id}/${rel}`,
      kind,
      filename,
      relativePath: rel.replace(/\\/g, "/"),
      url: `/api/runs/${run.id}/media/${rel.replace(/\\/g, "/")}`,
      label: filename,
      createdAt,
    });
  }

  return items;
}
