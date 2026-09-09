import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CreateGameModal, type GameConfig } from "./CreateGameModal";
import { exportGddToExcel } from "./exportGddExcel";
import { SlotGame } from "./SlotGame";
import {
  type GddRow,
  type MediaItem,
  type ProgressEvent,
  type RunRecord,
  type RunStatus,
} from "./types";

interface RunSummary {
  id: string;
  url: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  mediaCount: number;
  filledCount?: number;
  currentActivity?: string;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatHistoryLabel(r: RunSummary): string {
  const when = (() => {
    try {
      return new Date(r.createdAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return r.createdAt.slice(0, 16);
    }
  })();
  let host = r.url;
  try {
    const u = new URL(r.url);
    host = u.searchParams.get("game") || u.hostname;
  } catch {
    // keep raw
  }
  const shortId = r.id.slice(0, 8);
  const bits = [`${shortId} · ${when}`, host, r.status];
  if (r.filledCount) bits.push(`${r.filledCount} fields`);
  if (r.mediaCount) bits.push(`${r.mediaCount} media`);
  return bits.join(" · ");
}

function isImage(item: MediaItem): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(item.filename);
}

function isAudio(item: MediaItem): boolean {
  return /\.(mp3|ogg|wav|m4a|aac)$/i.test(item.filename);
}

function isLiveView(item: MediaItem): boolean {
  return /live_view/i.test(item.relativePath) || /live_view/i.test(item.filename);
}

/** Merge media by path — never drop previously seen files for this run. */
function mergeMedia(prev: MediaItem[], next: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();
  for (const item of prev) map.set(item.relativePath, item);
  for (const item of next) map.set(item.relativePath, item);
  return [...map.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export default function App() {
  const [url, setUrl] = useState(
    "https://demo.bltr-static.com/belatra/demo?language=en&game=jewels10",
  );
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [otherText, setOtherText] = useState<string | null>(null);
  const [mediaTab, setMediaTab] = useState<"photos" | "symbols" | "wins" | "sounds" | "files">(
    "photos",
  );
  const [liveTick, setLiveTick] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyId, setHistoryId] = useState("");

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      if (!res.ok) return;
      const list = (await res.json()) as RunSummary[];
      setHistory(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setLiveTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, [busy]);

  const applyRun = useCallback((latest: RunRecord, replaceEvents = false) => {
    setRun((prev) => {
      const same = prev?.id === latest.id;
      const media = mergeMedia(same ? prev.media ?? [] : [], latest.media ?? []);
      return { ...latest, media };
    });
    setMediaItems((prev) => {
      const kept = prev.filter((m) => m.id.startsWith(`${latest.id}/`));
      return mergeMedia(kept, latest.media ?? []);
    });
    if (replaceEvents) setEvents(latest.events);
  }, []);

  const attachStream = useCallback(
    (runId: string) => {
      const es = new EventSource(`/api/runs/${runId}/events`);
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as {
            type: string;
            run?: RunRecord;
            event?: ProgressEvent;
            status?: RunStatus;
          };

          if (data.type === "snapshot" && data.run) {
            applyRun(data.run, true);
          }
          if (data.type === "run" && data.run) {
            applyRun(data.run);
          }
          if (data.type === "event" && data.event) {
            setEvents((prev) => {
              const exists = prev.some(
                (e) => e.ts === data.event!.ts && e.message === data.event!.message,
              );
              return exists ? prev : [...prev, data.event!];
            });
          }
          if (data.type === "finished") {
            setBusy(false);
            void fetch(`/api/runs/${runId}`)
              .then((r) => r.json())
              .then((latest: RunRecord) => {
                applyRun(latest, true);
              });
            void refreshHistory();
            es.close();
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        void fetch(`/api/runs/${runId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((latest: RunRecord | null) => {
            if (!latest) return;
            applyRun(latest, true);
            if (
              latest.status === "completed" ||
              latest.status === "error" ||
              latest.status === "cancelled"
            ) {
              setBusy(false);
              void refreshHistory();
              es.close();
            }
          });
      };
      return es;
    },
    [applyRun, refreshHistory],
  );

  async function loadHistoryRun(id: string) {
    if (!id || busy) return;
    setFormError(null);
    setCreateOpen(false);
    setGameConfig(null);
    setSelectedPath(null);
    setOtherText(null);
    setMediaTab("photos");
    try {
      const res = await fetch(`/api/runs/${id}`);
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error || "Failed to load run");
        return;
      }
      const latest = body as RunRecord;
      setHistoryId(latest.id);
      setUrl(latest.url);
      setBusy(false);
      setRun({ ...latest, media: latest.media ?? [] });
      setEvents(latest.events ?? []);
      setMediaItems(latest.media ?? []);
      // Restore created game if present
      void fetch(`/api/runs/${latest.id}/game`)
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg: GameConfig | null) => {
          if (cfg) setGameConfig(cfg);
        })
        .catch(() => undefined);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onStop() {
    if (!run?.id || !busy) return;
    try {
      const res = await fetch(`/api/runs/${run.id}/stop`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.message || body.error || "Failed to stop");
        return;
      }
      if (body.run) applyRun(body.run as RunRecord);
      setBusy(false);
      void refreshHistory();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setFormError("Paste a demo URL.");
      return;
    }

    setBusy(true);
    setEvents([]);
    setMediaItems([]);
    setSelectedPath(null);
    setOtherText(null);
    setMediaTab("photos");
    setRun(null);
    setCreateOpen(false);
    setGameConfig(null);

    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setBusy(false);
        setFormError(body.error || "Failed to start run");
        return;
      }
      const created = body as RunRecord;
      setRun(created);
      setHistoryId(created.id);
      setEvents(created.events);
      setMediaItems(created.media ?? []);
      attachStream(created.id);
      void refreshHistory();
    } catch (err) {
      setBusy(false);
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  const rows: GddRow[] = run?.rows ?? [];
  const status: RunStatus | null = run?.status ?? null;

  const archiveMedia = useMemo(
    () => mediaItems.filter((m) => !isLiveView(m)),
    [mediaItems],
  );

  const photoMedia = useMemo(
    () =>
      archiveMedia.filter(
        (m) =>
          (m.kind === "screenshot" || m.relativePath.startsWith("screenshots/")) &&
          isImage(m),
      ),
    [archiveMedia],
  );

  const symbolMedia = useMemo(
    () =>
      archiveMedia.filter(
        (m) =>
          (m.kind === "symbol" || m.relativePath.startsWith("symbols/")) && isImage(m),
      ),
    [archiveMedia],
  );

  const winMedia = useMemo(
    () =>
      archiveMedia.filter(
        (m) => (m.kind === "win" || m.relativePath.startsWith("wins/")) && isImage(m),
      ),
    [archiveMedia],
  );

  const soundMedia = useMemo(
    () =>
      archiveMedia.filter(
        (m) =>
          m.kind === "sound" ||
          m.relativePath.startsWith("sounds/") ||
          isAudio(m),
      ),
    [archiveMedia],
  );

  const fileMedia = useMemo(
    () =>
      archiveMedia.filter(
        (m) =>
          m.kind === "other" ||
          m.relativePath.startsWith("other/") ||
          (!isImage(m) && !isAudio(m)),
      ),
    [archiveMedia],
  );

  const tabMedia = useMemo(() => {
    switch (mediaTab) {
      case "photos":
        return photoMedia;
      case "symbols":
        return symbolMedia;
      case "wins":
        return winMedia;
      case "sounds":
        return soundMedia;
      case "files":
        return fileMedia;
      default:
        return photoMedia;
    }
  }, [mediaTab, photoMedia, symbolMedia, winMedia, soundMedia, fileMedia]);

  const visualMedia = useMemo(
    () => [...photoMedia, ...symbolMedia, ...winMedia, ...soundMedia],
    [photoMedia, symbolMedia, winMedia, soundMedia],
  );

  const liveItem = useMemo(
    () => mediaItems.find(isLiveView),
    [mediaItems],
  );

  const selected =
    tabMedia.find((m) => m.relativePath === selectedPath) ||
    visualMedia.find((m) => m.relativePath === selectedPath) ||
    fileMedia.find((m) => m.relativePath === selectedPath) ||
    liveItem ||
    tabMedia[0] ||
    null;

  useEffect(() => {
    if (tabMedia.length === 0) return;
    const inTab = tabMedia.some((m) => m.relativePath === selectedPath);
    if (!inTab) setSelectedPath(tabMedia[0].relativePath);
  }, [mediaTab, tabMedia, selectedPath]);

  useEffect(() => {
    if (!selectedPath && (liveItem || tabMedia[0])) {
      setSelectedPath((liveItem && mediaTab === "photos" ? liveItem : tabMedia[0])!.relativePath);
    }
  }, [liveItem, tabMedia, selectedPath, mediaTab]);

  useEffect(() => {
    if (!selected) {
      setOtherText(null);
      return;
    }
    if (isImage(selected) || isAudio(selected)) {
      setOtherText(null);
      return;
    }
    let cancelled = false;
    void fetch(`${selected.url}?v=${selected.createdAt}`)
      .then((r) => r.text())
      .then((t) => {
        if (cancelled) return;
        try {
          setOtherText(JSON.stringify(JSON.parse(t), null, 2));
        } catch {
          setOtherText(t.slice(0, 20000));
        }
      })
      .catch(() => {
        if (!cancelled) setOtherText("(could not load file)");
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const liveSrc = selected && isImage(selected)
    ? `${selected.url}?t=${selected.createdAt || liveTick}`
    : liveItem
      ? `${liveItem.url}?t=${liveItem.createdAt || liveTick}`
      : null;

  const filledCount = useMemo(
    () => rows.filter((r) => r.value.trim() && r.parameter !== "Reference Game / URL").length,
    [rows],
  );

  const canCreateGame =
    Boolean(run?.id) &&
    !busy &&
    status !== "queued" &&
    status !== "running" &&
    (visualMedia.length > 0 || fileMedia.length > 0 || (run?.media?.length ?? 0) > 0);

  return (
    <div className="app">
      <header className="header">
        <h1>Demo → GDD</h1>
        <p>
          Paste a casino demo link and we’ll watch the game, catch a couple of wins, and fill
          out the GDD from what’s actually on screen. When you’re done, tweak the details and
          build a small playable game from the symbols we cut out — or reopen an old run from
          history so you don’t have to scrape again.
        </p>
      </header>

      <form className="compose" onSubmit={onSubmit}>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/demo"
          disabled={busy}
          required
        />
        <select
          className="history-select"
          value={historyId}
          disabled={busy}
          aria-label="Load previous run"
          onChange={(e) => {
            const id = e.target.value;
            setHistoryId(id);
            if (id) void loadHistoryRun(id);
          }}
        >
          <option value="">History (run ids)…</option>
          {history.map((h) => (
            <option key={h.id} value={h.id}>
              {formatHistoryLabel(h)}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          {busy ? "Running…" : "Extract GDD"}
        </button>
        {busy && (
          <button type="button" className="stop" onClick={() => void onStop()}>
            Stop
          </button>
        )}
        {canCreateGame && (
          <button
            type="button"
            className="create-game"
            onClick={() => setCreateOpen(true)}
          >
            Create Game
          </button>
        )}
      </form>

      <div className="meta">
        {status && <span className={`badge ${status}`}>{status}</span>}
        {run?.currentActivity && <span className="activity">{run.currentActivity}</span>}
        {run && (
          <span>
            Run {run.id.slice(0, 8)} · Filled {filledCount} · Media {visualMedia.length}
            {fileMedia.length ? ` · files ${fileMedia.length}` : ""}
          </span>
        )}
      </div>

      {(formError || run?.error) && (
        <div className="error-banner">{formError || run?.error}</div>
      )}

      {busy && (
        <div className="browser-hint">
          Cursor agent is working on the demo URL. Watch progress below — we only request the data;
          the agent decides how to get it.
        </div>
      )}

      <div className="layout-top">
        <section className="panel">
          <h2>How it works</h2>
          <div className="how-it-works">
            <p>Open the demo, enter the playable game, find spin, and play until 2 wins — then stop spinning.</p>
            <p>Save win screens plus spin and win sounds. Cut each unique reel symbol (the icons on the grid) into symbols/ — not full screenshots, not made-up names.</p>
            <p>Open languages, info/rules, paytable, and settings to fill the GDD (screenshot only when that panel is really open).</p>
            <p>Return the GDD JSON. After that you can Create Game from history without researching again.</p>
          </div>
        </section>

        <section className="panel">
          <h2>Live log</h2>
          {events.length === 0 ? (
            <div className="progress-empty">
              Start a run or pick a history id to load saved data.
            </div>
          ) : (
            <div className="progress">
              {events.map((ev, i) => (
                <div className={`event ${ev.type}`} key={`${ev.ts}-${i}`}>
                  <time>{formatTime(ev.ts)}</time>
                  <div className="msg">
                    {ev.type !== "assistant" && ev.type !== "tool" && (
                      <span className="tag">{ev.type}</span>
                    )}
                    {ev.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel media-panel">
        <h2>Scraped media</h2>

        <div className="media-tabs" role="tablist" aria-label="Media type">
          {(
            [
              ["photos", "Photos", photoMedia.length],
              ["symbols", "Symbols", symbolMedia.length],
              ["wins", "Wins", winMedia.length],
              ["sounds", "Sounds", soundMedia.length],
              ["files", "Files", fileMedia.length],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mediaTab === id}
              className={mediaTab === id ? "active" : undefined}
              onClick={() => setMediaTab(id)}
            >
              {label}
              <span className="tab-count">{count}</span>
            </button>
          ))}
        </div>

        <div className="media-stage">
          {selected && isImage(selected) ? (
            <img
              key={`${selected.relativePath}-${liveTick}`}
              src={`${selected.url}?t=${selected.createdAt || liveTick}`}
              alt={selected.label}
            />
          ) : selected && isAudio(selected) ? (
            <div className="stage-audio">
              <p>{selected.label}</p>
              <audio key={selected.relativePath} controls preload="metadata" src={selected.url} />
            </div>
          ) : selected && otherText != null ? (
            <pre className="stage-code">{otherText}</pre>
          ) : liveSrc && mediaTab === "photos" ? (
            <img key={liveSrc} src={liveSrc} alt="Latest view" />
          ) : (
            <div className="progress-empty">Nothing in this tab yet.</div>
          )}
          {selected && (
            <div className="stage-caption">
              <span className="pill on">{selected.kind}</span> {selected.relativePath}
            </div>
          )}
        </div>

        {tabMedia.length === 0 ? (
          <div className="progress-empty">
            {mediaTab === "photos" && "No photos yet — screenshots land here."}
            {mediaTab === "symbols" && "No symbol cuts yet."}
            {mediaTab === "wins" && "No win captures yet."}
            {mediaTab === "sounds" && "No spin or win sounds yet."}
            {mediaTab === "files" && "No raw JSON / network files yet."}
          </div>
        ) : mediaTab === "files" ? (
          <ul className="other-list files-tab-list">
            {tabMedia.map((item) => (
              <li key={item.relativePath}>
                <button
                  type="button"
                  className={selected?.relativePath === item.relativePath ? "selected" : undefined}
                  onClick={() => setSelectedPath(item.relativePath)}
                >
                  {item.relativePath}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="media-grid">
            {tabMedia.map((item) => (
              <button
                type="button"
                key={item.relativePath}
                className={`media-card kind-${item.kind}${
                  selected?.relativePath === item.relativePath ? " selected" : ""
                }`}
                onClick={() => setSelectedPath(item.relativePath)}
              >
                <div className="media-preview">
                  {isImage(item) ? (
                    <img src={`${item.url}?v=${item.createdAt}`} alt={item.label} />
                  ) : isAudio(item) ? (
                    <span className="audio-thumb">♪ sound</span>
                  ) : (
                    <span>{item.filename}</span>
                  )}
                </div>
                <span className="media-cap">
                  <span className="pill on">{item.kind}</span> {item.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head-row">
          <h2>GDD table</h2>
          <div className="panel-actions">
            <button
              type="button"
              className="export-excel"
              disabled={rows.length === 0}
              onClick={() =>
                exportGddToExcel(rows, {
                  runId: run?.id,
                  gameName: rows.find((r) => r.parameter === "Game Name")?.value,
                })
              }
            >
              Export Excel
            </button>
            {canCreateGame && (
              <button
                type="button"
                className="create-game panel-create"
                onClick={() => setCreateOpen(true)}
              >
                Create Game
              </button>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Parameter</th>
                <th>Value</th>
                <th>Notes</th>
                <th>Source</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="value-cell empty">
                    No rows yet
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const empty = !row.value.trim();
                  return (
                    <tr
                      key={`${row.section}-${row.parameter}-${idx}`}
                      className={row.extra ? "row-extra" : undefined}
                    >
                      <td className="section-cell">
                        {row.section}
                        {row.extra ? <span className="pill on">extra</span> : null}
                      </td>
                      <td className="param-cell">{row.parameter}</td>
                      <td className={`value-cell ${empty ? "empty" : "filled"}`}>
                        {empty ? "—" : row.value}
                      </td>
                      <td className={row.notes ? undefined : "value-cell empty"}>
                        {row.notes || "—"}
                      </td>
                      <td>
                        <span className={`pill ${row.source ? "on" : ""}`}>
                          {row.source || "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${row.confidence ? "on" : ""}`}>
                          {row.confidence || "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {gameConfig && (
        <SlotGame config={gameConfig} onClose={() => setGameConfig(null)} />
      )}

      {run?.id && (
        <CreateGameModal
          runId={run.id}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(cfg) => {
            setCreateOpen(false);
            setGameConfig(cfg);
          }}
        />
      )}
    </div>
  );
}
