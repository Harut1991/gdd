import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { mediaRoot } from "./media.js";
import type { GddRow } from "./types.js";

export interface GameCreateInput {
  gameName?: string;
  theme?: string;
  layout?: string;
  paylines?: number | string;
  reels?: number;
  rows?: number;
  currency?: string;
  minBet?: string;
  maxBet?: string;
  winMechanic?: string;
  /** Selected cut/scraped symbols (id + optional rename) */
  selectedSymbols?: Array<{ id: string; label?: string }>;
  /** Relative media path for spin SFX */
  spinSound?: string | null;
  /** Relative media paths for win SFX */
  winSounds?: string[];
}

export interface DraftSymbol {
  id: string;
  label: string;
  /** path under game/preview or media */
  path: string;
  url: string;
  source: "search" | "cut";
  selected: boolean;
}

export interface DraftSound {
  id: string;
  label: string;
  path: string;
  url: string;
  kind: "spin" | "win" | "other";
}

export interface GameSymbol {
  id: string;
  label: string;
  path: string;
  url: string;
}

export interface GameSound {
  id: string;
  label: string;
  path: string;
  url: string;
  kind: "spin" | "win";
}

export interface GameConfig {
  runId: string;
  gameName: string;
  theme: string;
  layout: string;
  reels: number;
  rows: number;
  paylines: number;
  currency: string;
  minBet: string;
  maxBet: string;
  winMechanic: string;
  symbols: GameSymbol[];
  sounds: GameSound[];
  spinSound: GameSound | null;
  winSounds: GameSound[];
  sourceImage: string;
  createdAt: string;
}

function rowValue(rows: GddRow[], parameter: string): string {
  return (rows.find((r) => r.parameter === parameter)?.value ?? "").trim();
}

export function draftFromRows(rows: GddRow[]): Omit<GameCreateInput, "selectedSymbols" | "spinSound" | "winSounds"> {
  const layout = rowValue(rows, "Layout") || "5x3";
  const { reels, rows: r } = parseLayout(layout);
  const payRaw = rowValue(rows, "Paylines / Ways");
  const payMatch = payRaw.match(/(\d+)/);
  return {
    gameName: rowValue(rows, "Game Name") || "Untitled Slot",
    theme: rowValue(rows, "Theme") || "Jewels",
    layout,
    reels,
    rows: r,
    paylines: payMatch ? Number(payMatch[1]) : 10,
    currency: rowValue(rows, "Currency") || "EUR",
    minBet: rowValue(rows, "Min Bet") || "0.10",
    maxBet: rowValue(rows, "Max Bet") || "100",
    winMechanic: rowValue(rows, "Win Mechanic") || "Left to right",
  };
}

export function parseLayout(layout: string): { reels: number; rows: number } {
  const m = layout.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (m) return { reels: Number(m[1]), rows: Number(m[2]) };
  const reels = layout.match(/(\d+)\s*reel/i);
  const rows = layout.match(/(\d+)\s*row/i);
  return {
    reels: reels ? Number(reels[1]) : 5,
    rows: rows ? Number(rows[1]) : 3,
  };
}

function gameRoot(runId: string): string {
  return path.join(mediaRoot(runId), "..", "game");
}

function guessSoundKind(name: string): "spin" | "win" | "other" {
  const n = name.toLowerCase();
  if (/win|bigwin|prize|payout|celebrate/.test(n)) return "win";
  if (/spin|reel|roll|start/.test(n)) return "spin";
  return "other";
}

async function findSourceImage(runId: string): Promise<string | null> {
  const root = mediaRoot(runId);
  const candidates = [
    "symbols/picts.png",
    "symbols/symbols.png",
    "symbols/paytable_symbols.png",
    "screenshots/04_paytable.png",
    "screenshots/paytable_01.png",
    "screenshots/main_game.png",
    "screenshots/01_main_game.png",
    "symbols/reels_idle.png",
  ];
  for (const rel of candidates) {
    try {
      await fs.access(path.join(root, rel));
      return path.join(root, rel);
    } catch {
      // continue
    }
  }

  try {
    const symDir = path.join(root, "symbols");
    const files = await fs.readdir(symDir);
    const prefer = files
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .filter((f) => !/reels_spin/i.test(f))
      .sort();
    if (prefer[0]) return path.join(symDir, prefer[0]);
    const any = files.find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (any) return path.join(symDir, any);
  } catch {
    // ignore
  }

  try {
    const shotDir = path.join(root, "screenshots");
    const files = await fs.readdir(shotDir);
    const main = files.find((f) => /main/i.test(f) && /\.png$/i.test(f));
    if (main) return path.join(shotDir, main);
  } catch {
    // ignore
  }
  return null;
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

function findBlobs(
  data: Buffer,
  width: number,
  height: number,
  threshold = 28,
  minArea = 900,
): Box[] {
  const visited = new Uint8Array(width * height);
  const boxes: Box[] = [];
  const isInk = (i: number) => {
    const o = i * 4;
    return Math.max(data[o], data[o + 1], data[o + 2]) > threshold;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || !isInk(start)) continue;

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let area = 0;
      const stack = [start];
      visited[start] = 1;

      while (stack.length) {
        const i = stack.pop()!;
        const cx = i % width;
        const cy = (i / width) | 0;
        area++;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        const neighbors = [i - 1, i + 1, i - width, i + width];
        for (const n of neighbors) {
          if (n < 0 || n >= width * height || visited[n]) continue;
          const nx = n % width;
          const ny = (n / width) | 0;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (!isInk(n)) continue;
          visited[n] = 1;
          stack.push(n);
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      if (area < minArea) continue;
      if (w < 24 || h < 24) continue;
      if (w > width * 0.85 && h > height * 0.85) continue;
      boxes.push({ minX, minY, maxX, maxY, area });
    }
  }

  boxes.sort((a, b) => {
    const ay = (a.minY + a.maxY) / 2;
    const by = (b.minY + b.maxY) / 2;
    if (Math.abs(ay - by) > 40) return ay - by;
    return a.minX - b.minX;
  });

  const kept: Box[] = [];
  for (const b of boxes) {
    const overlap = kept.find((k) => {
      const ix = Math.max(0, Math.min(b.maxX, k.maxX) - Math.max(b.minX, k.minX));
      const iy = Math.max(0, Math.min(b.maxY, k.maxY) - Math.max(b.minY, k.minY));
      const inter = ix * iy;
      const smaller = Math.min(b.area, k.area);
      return inter > smaller * 0.55;
    });
    if (!overlap) kept.push(b);
    else if (b.area > overlap.area) {
      kept[kept.indexOf(overlap)] = b;
    }
  }
  return kept.slice(0, 24);
}

async function writeCroppedSymbol(
  sourcePath: string,
  box: Box,
  outPath: string,
): Promise<void> {
  const meta = await sharp(sourcePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const pad = 4;
  const left = Math.max(0, box.minX - pad);
  const top = Math.max(0, box.minY - pad);
  const w = Math.min(width - left, box.maxX - box.minX + 1 + pad * 2);
  const h = Math.min(height - top, box.maxY - box.minY + 1 + pad * 2);

  const cropped = await sharp(sourcePath)
    .extract({ left, top, width: w, height: h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = Buffer.from(cropped.data);
  for (let p = 0; p < px.length; p += 4) {
    if (Math.max(px[p], px[p + 1], px[p + 2]) < 22) px[p + 3] = 0;
  }

  await sharp(px, {
    raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 },
  })
    .png()
    .toFile(outPath);
}

async function extractFromAtlas(
  sourcePath: string,
  outDir: string,
  runId: string,
  urlBase: "preview" | "symbols",
): Promise<GameSymbol[]> {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const boxes = findBlobs(data, info.width, info.height);
  if (boxes.length < 3) return [];

  const symbols: GameSymbol[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const id = `symbol_${String(i + 1).padStart(2, "0")}`;
    const filename = `${id}.png`;
    const outPath = path.join(outDir, filename);
    await writeCroppedSymbol(sourcePath, boxes[i], outPath);
    symbols.push({
      id,
      label: `Symbol ${i + 1}`,
      path: `${urlBase}/${filename}`,
      url: `/api/runs/${runId}/game/${urlBase}/${filename}`,
    });
  }
  return symbols;
}

async function extractFromReelGrid(
  sourcePath: string,
  outDir: string,
  reels: number,
  rows: number,
  runId: string,
  urlBase: "preview" | "symbols",
): Promise<GameSymbol[]> {
  const meta = await sharp(sourcePath).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const left = Math.round(width * 0.18);
  const top = Math.round(height * 0.16);
  const rw = Math.round(width * 0.64);
  const rh = Math.round(height * 0.58);
  const cellW = Math.floor(rw / reels);
  const cellH = Math.floor(rh / rows);
  const inset = Math.max(4, Math.floor(Math.min(cellW, cellH) * 0.08));

  const symbols: GameSymbol[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < reels; c++) {
      const id = `symbol_${String(idx + 1).padStart(2, "0")}`;
      const filename = `${id}.png`;
      const outPath = path.join(outDir, filename);
      await sharp(sourcePath)
        .extract({
          left: left + c * cellW + inset,
          top: top + r * cellH + inset,
          width: Math.max(8, cellW - inset * 2),
          height: Math.max(8, cellH - inset * 2),
        })
        .png()
        .toFile(outPath);
      symbols.push({
        id,
        label: `Symbol ${idx + 1}`,
        path: `${urlBase}/${filename}`,
        url: `/api/runs/${runId}/game/${urlBase}/${filename}`,
      });
      idx++;
    }
  }

  const unique = symbols.filter((_, i) => i % Math.max(1, Math.floor(symbols.length / 8)) === 0);
  return (unique.length >= 3 ? unique : symbols).slice(0, 12);
}

async function listSearchSymbolFiles(runId: string): Promise<DraftSymbol[]> {
  const root = mediaRoot(runId);
  const out: DraftSymbol[] = [];
  try {
    const symDir = path.join(root, "symbols");
    const files = (await fs.readdir(symDir))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .filter((f) => !/reels_spin|live_view/i.test(f))
      .filter((f) => !/picts|symbols\.png|paytable_symbols/i.test(f))
      .sort();
    for (const f of files) {
      const id = `search_${f.replace(/\W+/g, "_")}`;
      out.push({
        id,
        label: f.replace(/\.[^.]+$/, ""),
        path: `symbols/${f}`,
        url: `/api/runs/${runId}/media/symbols/${f}`,
        source: "search",
        selected: true,
      });
    }
  } catch {
    // ignore
  }
  return out;
}

async function listSounds(runId: string): Promise<DraftSound[]> {
  const root = mediaRoot(runId);
  const out: DraftSound[] = [];
  try {
    const soundDir = path.join(root, "sounds");
    const files = (await fs.readdir(soundDir))
      .filter((f) => /\.(mp3|ogg|wav|m4a|aac)$/i.test(f))
      .sort();
    for (const f of files) {
      const kind = guessSoundKind(f);
      out.push({
        id: `sound_${f.replace(/\W+/g, "_")}`,
        label: f,
        path: `sounds/${f}`,
        url: `/api/runs/${runId}/media/sounds/${f}`,
        kind,
      });
    }
  } catch {
    // ignore
  }
  return out;
}

/** Build selectable symbols + sounds for the Create Game popup. */
export async function prepareDraftAssets(
  runId: string,
  rows: GddRow[],
): Promise<{ symbols: DraftSymbol[]; sounds: DraftSound[]; sourceImage: string | null }> {
  const draft = draftFromRows(rows);
  const reels = Number(draft.reels) || 5;
  const rowCount = Number(draft.rows) || 3;
  const sounds = await listSounds(runId);

  // Prefer already-cut individual search symbols
  let symbols = await listSearchSymbolFiles(runId);

  const previewDir = path.join(gameRoot(runId), "preview");
  await fs.mkdir(previewDir, { recursive: true });

  // If few/no individual symbols, cut from atlas / reel shot into preview/
  if (symbols.length < 2) {
    const sourcePath = await findSourceImage(runId);
    if (sourcePath) {
      // Clear old preview
      for (const f of await fs.readdir(previewDir)) {
        await fs.unlink(path.join(previewDir, f));
      }
      let cut = await extractFromAtlas(sourcePath, previewDir, runId, "preview");
      if (cut.length < 3) {
        cut = await extractFromReelGrid(
          sourcePath,
          previewDir,
          reels,
          rowCount,
          runId,
          "preview",
        );
      }
      symbols = cut.map((s) => ({
        id: s.id,
        label: s.label,
        path: s.path,
        url: s.url,
        source: "cut" as const,
        selected: true,
      }));
      return {
        symbols,
        sounds,
        sourceImage: path.relative(mediaRoot(runId), sourcePath).replace(/\\/g, "/"),
      };
    }
  }

  // Also offer atlas cuts alongside search files when picts exists and search list is only reels-ish
  if (symbols.length < 4) {
    const sourcePath = await findSourceImage(runId);
    if (sourcePath && /picts|symbols\.png|paytable/i.test(sourcePath)) {
      for (const f of await fs.readdir(previewDir)) {
        await fs.unlink(path.join(previewDir, f));
      }
      const cut = await extractFromAtlas(sourcePath, previewDir, runId, "preview");
      if (cut.length >= 2) {
        symbols = cut.map((s) => ({
          id: s.id,
          label: s.label,
          path: s.path,
          url: s.url,
          source: "cut" as const,
          selected: true,
        }));
        return {
          symbols,
          sounds,
          sourceImage: path.relative(mediaRoot(runId), sourcePath).replace(/\\/g, "/"),
        };
      }
    }
  }

  const sourcePath = await findSourceImage(runId);
  return {
    symbols,
    sounds,
    sourceImage: sourcePath
      ? path.relative(mediaRoot(runId), sourcePath).replace(/\\/g, "/")
      : null,
  };
}

async function copyFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export async function createGameFromRun(
  runId: string,
  rows: GddRow[],
  input: GameCreateInput = {},
): Promise<GameConfig> {
  const draft = draftFromRows(rows);
  const layout = input.layout || draft.layout || "5x3";
  const parsed = parseLayout(layout);
  const reels = Number(input.reels) || parsed.reels;
  const rowCount = Number(input.rows) || parsed.rows;
  const paylines = Number(input.paylines) || Number(draft.paylines) || 10;

  const prepared = await prepareDraftAssets(runId, rows);
  if (!prepared.symbols.length) {
    throw new Error("No symbols found from search — re-run extract or capture symbol art first");
  }

  const selected =
    input.selectedSymbols?.length
      ? input.selectedSymbols
      : prepared.symbols.map((s) => ({ id: s.id, label: s.label }));

  const byId = new Map(prepared.symbols.map((s) => [s.id, s]));
  const chosen = selected
    .map((s) => {
      const base = byId.get(s.id);
      if (!base) return null;
      return { ...base, label: (s.label || base.label).trim() || base.label };
    })
    .filter(Boolean) as DraftSymbol[];

  if (chosen.length < 2) {
    throw new Error("Select at least 2 symbols for the game");
  }

  const root = gameRoot(runId);
  const symDir = path.join(root, "symbols");
  const soundDir = path.join(root, "sounds");
  await fs.mkdir(symDir, { recursive: true });
  await fs.mkdir(soundDir, { recursive: true });

  for (const f of await fs.readdir(symDir)) {
    await fs.unlink(path.join(symDir, f));
  }
  try {
    for (const f of await fs.readdir(soundDir)) {
      await fs.unlink(path.join(soundDir, f));
    }
  } catch {
    // ignore
  }

  const media = mediaRoot(runId);
  const symbols: GameSymbol[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const src = chosen[i];
    const id = `symbol_${String(i + 1).padStart(2, "0")}`;
    const filename = `${id}.png`;
    const dest = path.join(symDir, filename);
    const absSrc = src.path.startsWith("preview/")
      ? path.join(root, src.path)
      : path.join(media, src.path);
    await copyFile(absSrc, dest);
    symbols.push({
      id,
      label: src.label,
      path: `symbols/${filename}`,
      url: `/api/runs/${runId}/game/symbols/${filename}`,
    });
  }

  const soundByPath = new Map(prepared.sounds.map((s) => [s.path, s]));
  const spinPick =
    input.spinSound === null
      ? null
      : input.spinSound
        ? soundByPath.get(input.spinSound) ?? null
        : prepared.sounds.find((s) => s.kind === "spin") ?? null;

  const winPicks: DraftSound[] = [];
  if (input.winSounds?.length) {
    for (const p of input.winSounds) {
      const s = soundByPath.get(p);
      if (s) winPicks.push(s);
    }
  } else if (input.winSounds === undefined) {
    winPicks.push(...prepared.sounds.filter((s) => s.kind === "win"));
  }

  const sounds: GameSound[] = [];
  let spinSound: GameSound | null = null;
  const winSounds: GameSound[] = [];

  if (spinPick) {
    const filename = `spin${path.extname(spinPick.path) || ".ogg"}`;
    await copyFile(path.join(media, spinPick.path), path.join(soundDir, filename));
    spinSound = {
      id: "spin",
      label: spinPick.label,
      path: `sounds/${filename}`,
      url: `/api/runs/${runId}/game/sounds/${filename}`,
      kind: "spin",
    };
    sounds.push(spinSound);
  }

  for (let i = 0; i < winPicks.length; i++) {
    const w = winPicks[i];
    const filename = `win_${String(i + 1).padStart(2, "0")}${path.extname(w.path) || ".ogg"}`;
    await copyFile(path.join(media, w.path), path.join(soundDir, filename));
    const gs: GameSound = {
      id: `win_${i + 1}`,
      label: w.label,
      path: `sounds/${filename}`,
      url: `/api/runs/${runId}/game/sounds/${filename}`,
      kind: "win",
    };
    winSounds.push(gs);
    sounds.push(gs);
  }

  const config: GameConfig = {
    runId,
    gameName: (input.gameName || draft.gameName || "Untitled Slot").trim(),
    theme: (input.theme || draft.theme || "").trim(),
    layout: `${reels}x${rowCount}`,
    reels,
    rows: rowCount,
    paylines,
    currency: (input.currency || draft.currency || "EUR").trim(),
    minBet: (input.minBet || draft.minBet || "0.10").trim(),
    maxBet: (input.maxBet || draft.maxBet || "100").trim(),
    winMechanic: (input.winMechanic || draft.winMechanic || "").trim(),
    symbols,
    sounds,
    spinSound,
    winSounds,
    sourceImage: prepared.sourceImage || "",
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(root, "config.json"), JSON.stringify(config, null, 2), "utf8");
  return config;
}

export async function loadGameConfig(runId: string): Promise<GameConfig | null> {
  try {
    const raw = await fs.readFile(path.join(gameRoot(runId), "config.json"), "utf8");
    const cfg = JSON.parse(raw) as GameConfig;
    if (!cfg.sounds) cfg.sounds = [];
    if (!cfg.winSounds) cfg.winSounds = cfg.sounds.filter((s) => s.kind === "win");
    if (cfg.spinSound === undefined) {
      cfg.spinSound = cfg.sounds.find((s) => s.kind === "spin") ?? null;
    }
    return cfg;
  } catch {
    return null;
  }
}

export function gameAssetsRoot(runId: string): string {
  return gameRoot(runId);
}
