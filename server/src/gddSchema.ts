import type { GddRow } from "./types.js";

export interface GddFieldDef {
  section: string;
  parameter: string;
  key: string;
}

/** Sheet-1 style fields from the Betboyz / 18Peaches example (Asset sheet excluded). */
export const GDD_FIELDS: GddFieldDef[] = [
  { section: "GAME OVERVIEW", parameter: "Game Name", key: "gameName" },
  { section: "GAME OVERVIEW", parameter: "Reference Game / URL", key: "referenceUrl" },
  { section: "GAME OVERVIEW", parameter: "Game Type", key: "gameType" },
  { section: "GAME OVERVIEW", parameter: "Theme", key: "theme" },
  { section: "GAME OVERVIEW", parameter: "Layout", key: "layout" },
  { section: "GAME OVERVIEW", parameter: "Paylines / Ways", key: "paylinesWays" },
  { section: "GAME OVERVIEW", parameter: "Payout Types", key: "payoutTypes" },
  { section: "GAME OVERVIEW", parameter: "Win Mechanic", key: "winMechanic" },
  { section: "GAME OVERVIEW", parameter: "Game Mechanics", key: "gameMechanics" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Min Bet", key: "minBet" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Max Bet", key: "maxBet" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Bet Options", key: "betOptions" },
  {
    section: "TECHNICAL SPECIFICATIONS",
    parameter: "Difficulty / Volatility",
    key: "difficultyVolatility",
  },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Technology", key: "technology" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Platforms", key: "platforms" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Max Win", key: "maxWin" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "RTP", key: "rtp" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Provably Fair", key: "provablyFair" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Auto-Play / Slam", key: "autoPlay" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Languages", key: "languages" },
  { section: "TECHNICAL SPECIFICATIONS", parameter: "Currency", key: "currency" },
];

const KNOWN_KEYS = new Set(GDD_FIELDS.map((f) => f.key));

export function emptyGddRows(demoUrl: string): GddRow[] {
  return GDD_FIELDS.map((f) => ({
    section: f.section,
    parameter: f.parameter,
    value: f.key === "referenceUrl" ? demoUrl : "",
    notes: f.key === "referenceUrl" ? "Input demo URL" : "",
    source: f.key === "referenceUrl" ? ("research" as const) : "",
    confidence: f.key === "referenceUrl" ? ("high" as const) : "",
  }));
}

export interface AgentFieldPayload {
  value?: string | null;
  notes?: string | null;
  source?: "research" | "demo" | "network" | null;
  confidence?: "high" | "medium" | "low" | null;
  /** Human label when this is an extra/unknown field */
  parameter?: string | null;
  section?: string | null;
}

export interface AgentGddPayload {
  fields?: Record<string, AgentFieldPayload>;
  /** Extra discoveries not in the fixed GDD list — become new table rows */
  extraFields?: Array<{
    parameter?: string | null;
    value?: string | null;
    notes?: string | null;
    source?: "research" | "demo" | "network" | null;
    confidence?: "high" | "medium" | "low" | null;
    section?: string | null;
  }>;
  features?: Array<{
    name?: string | null;
    description?: string | null;
    trigger?: string | null;
    source?: "research" | "demo" | "network" | null;
    confidence?: "high" | "medium" | "low" | null;
  }>;
  media?: Array<{
    kind?: string | null;
    path?: string | null;
    label?: string | null;
  }>;
  playSummary?: {
    spinsAttempted?: number | null;
    winsSeen?: number | null;
    settingsOpened?: boolean | null;
    notes?: string | null;
  };
}

function isFillable(field: AgentFieldPayload | undefined): boolean {
  if (!field) return false;
  const value = (field.value ?? "").trim();
  if (!value) return false;
  if (field.confidence === "low" || !field.confidence) return false;
  if (field.confidence !== "high" && field.confidence !== "medium") return false;
  if (field.source !== "research" && field.source !== "demo" && field.source !== "network") {
    return false;
  }
  return true;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Merge agent JSON into rows. Uncertain / low / missing source → blank value. */
export function mergeAgentPayload(
  demoUrl: string,
  payload: AgentGddPayload | null,
): GddRow[] {
  const rows = emptyGddRows(demoUrl);
  const fields = payload?.fields ?? {};

  for (const def of GDD_FIELDS) {
    if (def.key === "referenceUrl") continue;
    const row = rows.find((r) => r.parameter === def.parameter);
    if (!row) continue;
    const raw = fields[def.key];
    if (!isFillable(raw)) {
      row.value = "";
      row.notes = "";
      row.source = "";
      row.confidence = "";
      continue;
    }
    row.value = String(raw!.value).trim();
    row.notes = (raw!.notes ?? "").trim();
    row.source = raw!.source as GddRow["source"];
    row.confidence = raw!.confidence as GddRow["confidence"];
  }

  // Unknown keys inside fields → ADDITIONAL columns
  for (const [key, raw] of Object.entries(fields)) {
    if (KNOWN_KEYS.has(key)) continue;
    if (!isFillable(raw)) continue;
    const parameter = (raw.parameter ?? "").trim() || humanizeKey(key);
    if (rows.some((r) => r.parameter === parameter)) continue;
    rows.push({
      section: (raw.section ?? "").trim() || "ADDITIONAL",
      parameter,
      value: String(raw.value).trim(),
      notes: (raw.notes ?? "").trim() || `Extra field key: ${key}`,
      source: raw.source as GddRow["source"],
      confidence: raw.confidence as GddRow["confidence"],
      extra: true,
    });
  }

  const extras = payload?.extraFields ?? [];
  for (const extra of extras) {
    const parameter = (extra.parameter ?? "").trim();
    if (!parameter) continue;
    const asField: AgentFieldPayload = {
      value: extra.value,
      notes: extra.notes,
      source: extra.source,
      confidence: extra.confidence,
    };
    if (!isFillable(asField)) continue;
    if (rows.some((r) => r.parameter === parameter && r.value === String(asField.value).trim())) {
      continue;
    }
    rows.push({
      section: (extra.section ?? "").trim() || "ADDITIONAL",
      parameter,
      value: String(asField.value).trim(),
      notes: asField.notes ?? "",
      source: asField.source as GddRow["source"],
      confidence: asField.confidence as GddRow["confidence"],
      extra: true,
    });
  }

  const features = payload?.features ?? [];
  for (const feat of features) {
    const name = (feat.name ?? "").trim();
    if (!name) continue;
    const asField: AgentFieldPayload = {
      value: (feat.description ?? "").trim() || name,
      notes: (feat.trigger ?? "").trim(),
      source: feat.source,
      confidence: feat.confidence,
    };
    if (!isFillable(asField)) continue;
    rows.push({
      section: "GAME FEATURES & RULES",
      parameter: name,
      value: String(asField.value).trim(),
      notes: asField.notes ?? "",
      source: asField.source as GddRow["source"],
      confidence: asField.confidence as GddRow["confidence"],
    });
  }

  return rows;
}

export function extractJsonPayload(text: string): AgentGddPayload | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text.trim();

  const tryParse = (s: string): AgentGddPayload | null => {
    try {
      return JSON.parse(s) as AgentGddPayload;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct) return direct;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(candidate.slice(start, end + 1));
  }
  return null;
}
