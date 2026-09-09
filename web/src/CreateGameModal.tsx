import { FormEvent, useEffect, useMemo, useState } from "react";

export interface GameDraft {
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
}

export interface DraftSymbol {
  id: string;
  label: string;
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
  sounds?: GameSound[];
  spinSound?: GameSound | null;
  winSounds?: GameSound[];
  sourceImage: string;
  createdAt: string;
}

interface Props {
  runId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (config: GameConfig) => void;
}

const emptyDraft: GameDraft = {
  gameName: "Untitled Slot",
  theme: "",
  layout: "5x3",
  reels: 5,
  rows: 3,
  paylines: 10,
  currency: "EUR",
  minBet: "0.10",
  maxBet: "100",
  winMechanic: "Left to right",
};

export function CreateGameModal({ runId, open, onClose, onCreated }: Props) {
  const [draft, setDraft] = useState<GameDraft>(emptyDraft);
  const [symbols, setSymbols] = useState<DraftSymbol[]>([]);
  const [sounds, setSounds] = useState<DraftSound[]>([]);
  const [spinSound, setSpinSound] = useState<string>("");
  const [winSounds, setWinSounds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const spinOptions = useMemo(
    () => sounds.filter((s) => s.kind === "spin" || s.kind === "other"),
    [sounds],
  );
  const winOptions = useMemo(
    () => sounds.filter((s) => s.kind === "win" || s.kind === "other"),
    [sounds],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void fetch(`/api/runs/${runId}/game/draft`)
      .then((r) => r.json())
      .then(
        (body: {
          draft?: Partial<GameDraft>;
          symbols?: DraftSymbol[];
          sounds?: DraftSound[];
          error?: string;
        }) => {
          if (body.error) throw new Error(body.error);
          const d = { ...emptyDraft, ...(body.draft ?? {}) };
          d.reels = Number(d.reels) || 5;
          d.rows = Number(d.rows) || 3;
          d.paylines = Number(d.paylines) || 10;
          d.layout = d.layout || `${d.reels}x${d.rows}`;
          setDraft(d);

          const syms = (body.symbols ?? []).map((s) => ({ ...s, selected: s.selected !== false }));
          setSymbols(syms);

          const snds = body.sounds ?? [];
          setSounds(snds);
          const firstSpin = snds.find((s) => s.kind === "spin");
          setSpinSound(firstSpin?.path ?? "");
          setWinSounds(snds.filter((s) => s.kind === "win").map((s) => s.path));
        },
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [open, runId]);

  function setField<K extends keyof GameDraft>(key: K, value: GameDraft[K]) {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "reels" || key === "rows") {
        next.layout = `${next.reels}x${next.rows}`;
      }
      return next;
    });
  }

  function toggleSymbol(id: string) {
    setSymbols((prev) =>
      prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)),
    );
  }

  function renameSymbol(id: string, label: string) {
    setSymbols((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }

  function toggleWinSound(path: string) {
    setWinSounds((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const selectedSymbols = symbols
      .filter((s) => s.selected)
      .map((s) => ({ id: s.id, label: s.label }));

    if (selectedSymbols.length < 2) {
      setError("Select at least 2 symbols from the search results.");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`/api/runs/${runId}/create-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          selectedSymbols,
          spinSound: spinSound || null,
          winSounds,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed to create game");
        setBusy(false);
        return;
      }
      onCreated(body as GameConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-game-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="create-game-title">Create game</h2>
          <p>
            Use symbols and sounds from this search. Tick what you want, rename if needed, then
            build the slot.
          </p>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {loading ? (
          <div className="progress-empty">Loading symbols & sounds from search…</div>
        ) : (
          <form className="modal-form" onSubmit={(e) => void onSubmit(e)}>
            <label>
              Game name
              <input
                value={draft.gameName}
                onChange={(e) => setField("gameName", e.target.value)}
                required
              />
            </label>
            <label>
              Theme
              <input value={draft.theme} onChange={(e) => setField("theme", e.target.value)} />
            </label>
            <div className="modal-row">
              <label>
                Reels
                <input
                  type="number"
                  min={3}
                  max={8}
                  value={draft.reels}
                  onChange={(e) => setField("reels", Number(e.target.value) || 5)}
                />
              </label>
              <label>
                Rows
                <input
                  type="number"
                  min={2}
                  max={6}
                  value={draft.rows}
                  onChange={(e) => setField("rows", Number(e.target.value) || 3)}
                />
              </label>
              <label>
                Paylines
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.paylines}
                  onChange={(e) => setField("paylines", Number(e.target.value) || 1)}
                />
              </label>
            </div>
            <div className="modal-row">
              <label>
                Currency
                <input
                  value={draft.currency}
                  onChange={(e) => setField("currency", e.target.value)}
                />
              </label>
              <label>
                Min bet
                <input value={draft.minBet} onChange={(e) => setField("minBet", e.target.value)} />
              </label>
              <label>
                Max bet
                <input value={draft.maxBet} onChange={(e) => setField("maxBet", e.target.value)} />
              </label>
            </div>
            <label>
              Win mechanic
              <input
                value={draft.winMechanic}
                onChange={(e) => setField("winMechanic", e.target.value)}
              />
            </label>

            <fieldset className="modal-fieldset">
              <legend>
                Symbols from search{" "}
                <span className="muted">
                  ({symbols.filter((s) => s.selected).length}/{symbols.length})
                </span>
              </legend>
              {symbols.length === 0 ? (
                <p className="muted">
                  No symbols yet — run extract again so we can cut them from the demo art.
                </p>
              ) : (
                <div className="symbol-pick-grid">
                  {symbols.map((s) => (
                    <label
                      key={s.id}
                      className={`symbol-pick${s.selected ? " on" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={s.selected}
                        onChange={() => toggleSymbol(s.id)}
                      />
                      <img src={s.url} alt={s.label} />
                      <input
                        className="symbol-label-input"
                        value={s.label}
                        onChange={(e) => renameSymbol(s.id, e.target.value)}
                        disabled={!s.selected}
                      />
                      <span className="source-tag">{s.source}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="modal-fieldset">
              <legend>Sounds from search</legend>
              {sounds.length === 0 ? (
                <p className="muted">No spin/win sounds captured yet — optional.</p>
              ) : (
                <div className="sound-pick">
                  <div>
                    <h4>Spin sound</h4>
                    <label className="sound-row">
                      <input
                        type="radio"
                        name="spin-sound"
                        checked={!spinSound}
                        onChange={() => setSpinSound("")}
                      />
                      <span>None</span>
                    </label>
                    {spinOptions.map((s) => (
                      <label key={s.id} className="sound-row">
                        <input
                          type="radio"
                          name="spin-sound"
                          checked={spinSound === s.path}
                          onChange={() => setSpinSound(s.path)}
                        />
                        <span className="pill on">{s.kind}</span>
                        <span className="sound-name">{s.label}</span>
                        <audio controls preload="none" src={s.url} />
                      </label>
                    ))}
                  </div>
                  <div>
                    <h4>Win sound(s)</h4>
                    {winOptions.length === 0 ? (
                      <p className="muted">No win clips found.</p>
                    ) : (
                      winOptions.map((s) => (
                        <label key={s.id} className="sound-row">
                          <input
                            type="checkbox"
                            checked={winSounds.includes(s.path)}
                            onChange={() => toggleWinSound(s.path)}
                          />
                          <span className="pill on">{s.kind}</span>
                          <span className="sound-name">{s.label}</span>
                          <audio controls preload="none" src={s.url} />
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}
            </fieldset>

            {error && <div className="error-banner">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" disabled={busy || symbols.length === 0}>
                {busy ? "Creating…" : "Create game"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
