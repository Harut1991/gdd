export type GddSource = "research" | "demo" | "network";
export type GddConfidence = "high" | "medium";

export type RunStatus = "queued" | "running" | "completed" | "error" | "cancelled";

export type ProgressEventType =
  | "status"
  | "step"
  | "assistant"
  | "tool"
  | "error"
  | "done"
  | "media";

export interface GddRow {
  section: string;
  parameter: string;
  value: string;
  notes: string;
  source: GddSource | "";
  confidence: GddConfidence | "";
  /** True when this row was discovered outside the fixed GDD template */
  extra?: boolean;
}

export interface ProgressEvent {
  ts: string;
  type: ProgressEventType;
  message: string;
  /** Machine step id when type === "step" */
  step?: string;
}

export type MediaKind = "screenshot" | "symbol" | "win" | "sound" | "other";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  filename: string;
  relativePath: string;
  url: string;
  label: string;
  createdAt: string;
}

export interface RunRecord {
  id: string;
  url: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  events: ProgressEvent[];
  rows: GddRow[];
  media: MediaItem[];
  /** Human-readable current activity for the UI badge */
  currentActivity?: string;
  error?: string;
  agentId?: string;
  runId?: string;
}

/** Ordered playbook steps shown in the progress checklist. */
export const PLAYBOOK_STEPS = [
  { id: "open_demo", label: "Open demo" },
  { id: "reach_game", label: "Enter playable game" },
  { id: "find_spin", label: "Find spin / play" },
  { id: "spin_batch", label: "Play until 2 wins only" },
  { id: "capture_win", label: "Save win screens + spin/win music" },
  { id: "play_until_win", label: "Stop playing after 2nd win" },
  { id: "decide", label: "Open panels (lang / info / paytable / settings)" },
  { id: "capture_symbols", label: "Save symbol / reel media" },
  { id: "analyze_gdd", label: "Fill all GDD fields (+ extras)" },
  { id: "capture_apis", label: "Note useful APIs" },
  { id: "write_gdd", label: "Return GDD JSON" },
] as const;

export type PlaybookStepId = (typeof PLAYBOOK_STEPS)[number]["id"];
