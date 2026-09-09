import { useMemo, useRef, useState } from "react";
import type { GameConfig } from "./CreateGameModal";

interface Props {
  config: GameConfig;
  onClose: () => void;
}

function randomGrid(reels: number, rows: number, symbolCount: number): number[][] {
  return Array.from({ length: reels }, () =>
    Array.from({ length: rows }, () => Math.floor(Math.random() * symbolCount)),
  );
}

function countLineWins(grid: number[][], paylines: number): { lines: number; symbol: number | null } {
  const reels = grid.length;
  const rows = grid[0]?.length ?? 0;
  if (!reels || !rows) return { lines: 0, symbol: null };

  const patterns: number[][] = [];
  const mid = Math.floor(rows / 2);
  patterns.push(Array(reels).fill(mid));
  if (rows > 1) {
    patterns.push(Array(reels).fill(0));
    patterns.push(Array(reels).fill(rows - 1));
  }
  if (rows >= 3) {
    patterns.push(grid.map((_, i) => Math.min(rows - 1, Math.max(0, mid + (i % 2 === 0 ? -1 : 1)))));
    patterns.push(grid.map((_, i) => Math.min(rows - 1, Math.max(0, mid + (i % 2 === 0 ? 1 : -1)))));
  }

  let wins = 0;
  let winSym: number | null = null;
  for (const pat of patterns.slice(0, Math.max(1, paylines))) {
    const first = grid[0][pat[0]];
    let run = 1;
    for (let c = 1; c < reels; c++) {
      if (grid[c][pat[c]] === first) run++;
      else break;
    }
    if (run >= 3) {
      wins++;
      winSym = first;
    }
  }
  return { lines: wins, symbol: winSym };
}

function playUrl(url: string | undefined, ref: { current: HTMLAudioElement | null }) {
  if (!url) return;
  try {
    if (ref.current) {
      ref.current.pause();
      ref.current.currentTime = 0;
    }
    const a = new Audio(url);
    ref.current = a;
    void a.play().catch(() => undefined);
  } catch {
    // ignore autoplay blocks
  }
}

export function SlotGame({ config, onClose }: Props) {
  const symbols = config.symbols;
  const spinAudio = useRef<HTMLAudioElement | null>(null);
  const winAudio = useRef<HTMLAudioElement | null>(null);
  const [grid, setGrid] = useState(() =>
    randomGrid(config.reels, config.rows, Math.max(1, symbols.length)),
  );
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState<{ lines: number; symbol: number | null } | null>(null);
  const [balance, setBalance] = useState(1000);
  const bet = Math.max(0.1, Number.parseFloat(config.minBet) || 0.1);

  const winLabel = useMemo(() => {
    if (!lastWin || lastWin.lines <= 0 || lastWin.symbol == null) return null;
    const name = symbols[lastWin.symbol]?.label ?? "symbol";
    return `${lastWin.lines} line${lastWin.lines > 1 ? "s" : ""} · ${name}`;
  }, [lastWin, symbols]);

  function spin() {
    if (spinning || symbols.length === 0) return;
    if (balance < bet) return;
    setSpinning(true);
    setLastWin(null);
    setBalance((b) => Math.round((b - bet) * 100) / 100);
    playUrl(config.spinSound?.url, spinAudio);

    let ticks = 0;
    const id = window.setInterval(() => {
      setGrid(randomGrid(config.reels, config.rows, symbols.length));
      ticks++;
      if (ticks >= 10) {
        window.clearInterval(id);
        const final = randomGrid(config.reels, config.rows, symbols.length);
        setGrid(final);
        const result = countLineWins(final, config.paylines);
        setLastWin(result);
        if (result.lines > 0) {
          const payout = Math.round(bet * result.lines * 5 * 100) / 100;
          setBalance((b) => Math.round((b + payout) * 100) / 100);
          const wins = config.winSounds ?? [];
          if (wins.length) {
            const pick = wins[Math.floor(Math.random() * wins.length)];
            playUrl(pick.url, winAudio);
          }
        }
        setSpinning(false);
      }
    }, 70);
  }

  return (
    <section className="panel slot-panel">
      <div className="slot-head">
        <div>
          <h2>{config.gameName}</h2>
          <p className="slot-meta">
            {config.layout} · {config.paylines} lines · {config.theme || "theme"} ·{" "}
            {config.currency} {bet}
            {config.spinSound ? " · spin SFX" : ""}
            {(config.winSounds?.length ?? 0) > 0 ? ` · ${config.winSounds!.length} win SFX` : ""}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close game
        </button>
      </div>

      <div className="slot-board" data-spinning={spinning ? "1" : "0"}>
        {Array.from({ length: config.rows }, (_, row) => (
          <div className="slot-row" key={row}>
            {Array.from({ length: config.reels }, (_, col) => {
              const si = grid[col]?.[row] ?? 0;
              const sym = symbols[si];
              return (
                <div className="slot-cell" key={`${col}-${row}`}>
                  {sym ? (
                    <img src={sym.url} alt={sym.label} title={sym.label} />
                  ) : (
                    <span>?</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="slot-strip">
        {symbols.map((s) => (
          <figure key={s.id} className="slot-sym">
            <img src={s.url} alt={s.label} />
            <figcaption>{s.label}</figcaption>
          </figure>
        ))}
      </div>

      <div className="slot-controls">
        <span>
          Balance: {config.currency} {balance.toFixed(2)}
        </span>
        <span className={winLabel ? "slot-win" : "slot-idle"}>
          {spinning ? "Spinning…" : winLabel ? `Win · ${winLabel}` : "Ready"}
        </span>
        <button type="button" onClick={spin} disabled={spinning || symbols.length === 0}>
          {spinning ? "…" : "Spin"}
        </button>
      </div>
    </section>
  );
}
