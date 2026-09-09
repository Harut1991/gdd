import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProgressEvent, RunRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = path.resolve(__dirname, "../runs");

const listeners = new Map<string, Set<(event: ProgressEvent) => void>>();

export async function ensureRunsDir(): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
}

function runPath(id: string): string {
  return path.join(RUNS_DIR, `${id}.json`);
}

export async function saveRun(run: RunRecord): Promise<void> {
  await ensureRunsDir();
  run.updatedAt = new Date().toISOString();
  await writeFile(runPath(run.id), JSON.stringify(run, null, 2), "utf8");
}

export async function loadRun(id: string): Promise<RunRecord | null> {
  try {
    const raw = await readFile(runPath(id), "utf8");
    const run = JSON.parse(raw) as RunRecord;
    if (!run.media) run.media = [];
    if (!run.events) run.events = [];
    return run;
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureRunsDir();
  const files = await readdir(RUNS_DIR);
  const runs: RunRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const run = await loadRun(file.replace(/\.json$/, ""));
    if (run) runs.push(run);
  }
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function subscribe(runId: string, fn: (event: ProgressEvent) => void): () => void {
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(runId);
  };
}

export async function appendEvent(
  run: RunRecord,
  type: ProgressEvent["type"],
  message: string,
  step?: string,
): Promise<ProgressEvent> {
  const event: ProgressEvent = {
    ts: new Date().toISOString(),
    type,
    message,
    ...(step ? { step } : {}),
  };
  run.events.push(event);
  if (type === "step" || type === "status" || type === "tool" || type === "assistant") {
    run.currentActivity = message;
  }
  await saveRun(run);
  const set = listeners.get(run.id);
  if (set) {
    for (const fn of set) fn(event);
  }
  return event;
}
