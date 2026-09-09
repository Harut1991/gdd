import { GDD_FIELDS } from "./gddSchema.js";
import { PLAYBOOK_STEPS } from "./types.js";

export function buildExtractionPrompt(demoUrl: string, mediaDir: string): string {
  const fieldList = GDD_FIELDS.map(
    (f) => `- ${f.key} ("${f.parameter}")`,
  ).join("\n");

  return `Inspect this casino demo and return GDD JSON. Use Cursor tools/browser as needed.

Demo URL:
${demoUrl}

Media folder:
${mediaDir}
(subfolders: screenshots, symbols, wins, sounds, other)

## Media rule — QUALITY over quantity
Do NOT dump every frame or duplicate the main game under different names.
Capture ONLY what is useful for the GDD:

Screenshots / images (optional but preferred when interesting):
- ONE main game shot when playable: screenshots/01_main_game.png
- A few spin moments if useful (not every idle frame): screenshots/spin_01.png …
- Bonus / free-spin / feature scenes if they appear: screenshots/bonus_01.png …
- Interesting animations or feature moments if they stand out
- Panel shots ONLY after the panel is actually open (see below) — skip if you cannot open it

## REQUIRED — cut reel / spin SYMBOLS (individual tiles)
You MUST crop and save the actual spin elements from the reels (the gems/icons ON the grid — e.g. crystal shard, triangle gem, green bar, pink hex — whatever THIS game shows).
Do NOT invent names like "diamond/ball/cube" unless that is literally what you see.
Do NOT save full-screen shots into symbols/.
Do NOT include UI (logo, START, bet bar, flags, menus).

How:
1. From a clear idle or win frame where reels are visible (e.g. after a win)
2. Crop EACH unique reel symbol as its own small PNG
3. Save under symbols/ with simple names from what you see, e.g.:
   symbols/shard_purple.png, symbols/triangle_blue.png, symbols/rect_green.png, symbols/hex_pink.png
4. One file per unique symbol type (skip duplicates of the same icon)
5. Prefer tight crops of the icon only (transparent/black bg OK)

Also list them in the final JSON media array with kind "symbol".

Sounds — spin + win only (no ambient):
- Save reel/spin SFX when spinning starts or reels roll: sounds/spin_01.mp3 (or .ogg / .wav)
- Save win SFX / win music for each win: sounds/win_01.mp3, sounds/win_02.…
- Prefer short clips of those events only — not the full ambient loop, UI clicks, or whole-session recording
- If a clip cannot be isolated, skip that file (leave empty rather than dumping noise)

## CRITICAL — if you screenshot a panel, it must SHOW that panel
Languages / info / paytable / settings screenshots are OPTIONAL evidence for GDD fields.
If you take them:
1. Click the control first
2. WAIT until the panel is visibly different from the main reels
3. Only THEN save (02_languages.png, 03_info_rules.png, 04_paytable.png, 05_settings.png)
4. Same main-game frame renamed = FAILED — delete/skip it and leave field null if needed

You can fill languages / rules / paytable from reading the open panel text without saving every panel image.
Prefer reading + filling GDD over flooding media with lookalike screenshots.

## Phase A — Play until 2 wins, then STOP spinning
1. Enter the game (Continue/OK if needed)
2. Optional: 01_main_game.png when playable
3. Spin until 2 wins — save spin SFX (sounds/spin_01…) on spins
4. On each win: wins/win_01.png, wins/win_02.png + win SFX → sounds/win_01…
5. After reels are clear (idle or win): CUT unique reel symbols → symbols/*.png (required)
6. After 2nd win: NO more spins

## Phase B — Gather info without more play
Open language / info / paytable / settings as needed to FILL fields.
Screenshot a panel only if it clearly shows different UI content.
Close panels when done.

Suggested filenames when panels are truly open:
| Visible content | Filename |
|---|---|
| Language list | screenshots/02_languages.png |
| Rules / help | screenshots/03_info_rules.png |
| Paytable | screenshots/04_paytable.png |
| Settings | screenshots/05_settings.png |

live_view.png may be overwritten for progress; do not treat it as evidence.

## What to extract (fill or null — never invent RTP/max win)
${fieldList}

From languages UI → languages field.
From HUD or bet UI → currency, minBet, maxBet, betOptions.
From settings → autoPlay, turbo/fast as extraFields.
From info/paytable → layout, paylinesWays, features, extraFields with rule summaries.
Useful extras → extraFields (Provider, Turbo, Fast, Buy Bonus, …).

Optional progress ids: ${PLAYBOOK_STEPS.map((s) => s.id).join(", ")}
PROGRESS: <id> — note

## Final JSON only
{
  "fields": {
    "languages": { "value": "EN, DE, …", "source": "demo", "confidence": "high", "notes": "read from language panel" },
    "currency": { "value": "…", "source": "demo", "confidence": "high", "notes": "HUD|bet|settings" },
    "rtp": { "value": null }
  },
  "extraFields": [
    { "parameter": "Turbo / Fast", "value": "…", "source": "demo", "confidence": "high", "section": "ADDITIONAL" }
  ],
  "features": [],
  "media": [
    { "kind": "screenshot", "path": "screenshots/01_main_game.png", "label": "Main game" },
    { "kind": "win", "path": "wins/win_01.png", "label": "Win 1" },
    { "kind": "symbol", "path": "symbols/shard_purple.png", "label": "Purple shard (reel)" },
    { "kind": "symbol", "path": "symbols/triangle_blue.png", "label": "Blue triangle (reel)" },
    { "kind": "sound", "path": "sounds/spin_01.ogg", "label": "Spin SFX" },
    { "kind": "sound", "path": "sounds/win_01.ogg", "label": "Win SFX" }
  ],
  "apis": { "configApis": [], "spinApis": [], "assetApis": [], "notes": "" },
  "playSummary": {
    "reachedGame": true,
    "winsSeen": 2,
    "panelsOpened": ["languages", "info"],
    "notes": "cut unique reel symbols into symbols/; spin+win audio; no fake diamond/ball labels"
  }
}
`;
}
