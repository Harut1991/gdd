import assert from "node:assert/strict";
import {
  emptyGddRows,
  extractJsonPayload,
  mergeAgentPayload,
} from "../server/src/gddSchema.ts";

const url = "https://example.com/demo";

{
  const rows = emptyGddRows(url);
  const ref = rows.find((r) => r.parameter === "Reference Game / URL");
  assert.equal(ref?.value, url);
  assert.equal(ref?.source, "research");
}

{
  const payload = extractJsonPayload(`Here you go:
\`\`\`json
{
  "fields": {
    "gameName": { "value": "Chicken Route", "source": "research", "confidence": "high", "notes": "H1" },
    "rtp": { "value": "96%", "source": "research", "confidence": "high" },
    "technology": { "value": "maybe pixi", "source": "demo", "confidence": "low" },
    "minBet": { "value": "1", "confidence": "medium" }
  },
  "features": [
    { "name": "Cash Out", "description": "Bank win", "trigger": "UI button", "source": "demo", "confidence": "high" },
    { "name": "Guessed Feature", "description": "nope", "source": "demo", "confidence": "low" }
  ],
  "extraFields": [
    { "parameter": "Provider", "value": "Belatra", "source": "demo", "confidence": "high", "section": "ADDITIONAL" }
  ]
}
\`\`\`
`);
  assert.ok(payload);
  const rows = mergeAgentPayload(url, payload);
  const byParam = Object.fromEntries(rows.map((r) => [r.parameter, r]));
  assert.equal(byParam["Game Name"]?.value, "Chicken Route");
  assert.equal(byParam["RTP"]?.value, "96%");
  assert.equal(byParam["Technology"]?.value, "", "low confidence must blank");
  assert.equal(byParam["Min Bet"]?.value, "", "missing source must blank");
  assert.equal(byParam["Cash Out"]?.value, "Bank win");
  assert.equal(byParam["Guessed Feature"], undefined);
  assert.equal(byParam["Provider"]?.value, "Belatra");
  assert.equal(byParam["Provider"]?.extra, true);
}

console.log("gddSchema tests passed");
