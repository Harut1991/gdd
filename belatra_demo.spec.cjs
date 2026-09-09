const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('belatra demo evidence capture', async ({ page }) => {
  const url = 'https://demo.bltr-static.com/belatra/demo?language=en&game=jewels10';
  const outDir = '/var/www/gdd/server/runs/6cae086a-7b70-4803-8db2-39c6867a8e11/media';
  const shots = path.join(outDir, 'screenshots');
  const symbols = path.join(outDir, 'symbols');
  const wins = path.join(outDir, 'wins');
  const sounds = path.join(outDir, 'sounds');
  const other = path.join(outDir, 'other');

  for (const p of [shots, symbols, wins, sounds, other]) fs.mkdirSync(p, { recursive: true });

  const audioUrls = new Set();
  page.on('response', async (resp) => {
    try {
      const u = resp.url();
      if (/\.(mp3|ogg|wav|m4a)(\?|$)/i.test(u)) audioUrls.add(u);
    } catch {}
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  // Dismiss likely overlays
  const dismissTexts = ['Information', 'Ok', 'OK', 'Accept', 'Got it', 'Close', 'Continue', 'I understand'];
  for (let i = 0; i < 30; i++) {
    for (const t of dismissTexts) {
      const loc = page.getByRole('button', { name: new RegExp('^' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).first();
      if (await loc.count()) {
        try { await loc.click({ timeout: 500 }); } catch {}
      }
    }
    const x = page.locator('button[aria-label*="Close" i], button:has-text("×"), button:has-text("✕")').first();
    if (await x.count()) {
      try { await x.click({ timeout: 500 }); } catch {}
    }
    await page.waitForTimeout(250);
  }

  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, '01_lobby.png'), fullPage: false });

  // Open settings/bet panel (best effort)
  let settingsOpened = false;
  const openers = [
    'button:has-text("Settings")',
    'button:has-text("Bet")',
    'button:has-text("Paytable")',
    'button[aria-label*="Settings" i]',
    'button[aria-label*="Bet" i]',
    'button[aria-label*="Menu" i]',
    'button:has-text("≡")',
    'button:has-text("☰")'
  ];
  for (const sel of openers) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const has = await page.locator('text=/Bet|Min|Max|Currency|Paytable|Options|Settings/i').first().count();
      if (has) { settingsOpened = true; break; }
    }
  }

  await page.screenshot({ path: path.join(shots, '02_settings.png'), fullPage: false });

  // Read text for currency/bet labels (evidence only)
  const betText = await page.evaluate(() => document.body?.innerText || '');
  const currencyMatch = betText.match(/\b(EUR|USD|GBP|CAD|AUD|JPY|credits|Coins|Coin|credit|coins)\b/i);

  const spinButtonSelectors = [
    'button:has-text("SPIN")',
    'button:has-text("Spin")',
    'button[aria-label*="Spin" i]',
    '[role="button"]:has-text("SPIN")'
  ];
  let spinBtn = null;
  for (const sel of spinButtonSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count()) { spinBtn = loc; break; }
  }

  const winLocators = [
    page.locator('text=/Win|You win|Congratulations/i').first(),
    page.locator('.win, .Win, [class*="win" i]').first()
  ];

  const spinResults = [];
  const outcome = async () => {
    for (const w of winLocators) {
      try {
        if (await w.count() && await w.isVisible()) return 'win';
      } catch {}
    }
    return 'loss_or_unknown';
  };

  for (let i = 1; i <= 10; i++) {
    if (spinBtn) {
      await spinBtn.click({ timeout: 5000 }).catch(() => {});
    } else {
      await page.keyboard.press('Space').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }
    await page.waitForTimeout(2500);
    const res = await outcome();
    spinResults.push({ n: i, outcome: res });
    await page.screenshot({ path: path.join(symbols, `reels_spin_${String(i).padStart(2,'0')}.png`), fullPage: false }).catch(() => {});
    console.log(`PROGRESS: spin_batch — spin ${i}/10 result=${res === 'win' ? 'win' : 'loss|unknown'}`);
  }

  // Continue until win seen or max extra
  let winSeen = spinResults.some(r => r.outcome === 'win');
  let extra = 0;
  while (!winSeen && extra < 15) {
    extra++;
    const n = 10 + extra;
    if (spinBtn) await spinBtn.click({ timeout: 5000 }).catch(() => {});
    else { await page.keyboard.press('Space').catch(() => {}); }
    await page.waitForTimeout(2500);
    const res = await outcome();
    spinResults.push({ n, outcome: res });
    await page.screenshot({ path: path.join(symbols, `reels_spin_${String(n).padStart(2,'0')}.png`), fullPage: false }).catch(() => {});
    console.log(`PROGRESS: spin_batch — spin ${n}/10 result=${res === 'win' ? 'win' : 'loss|unknown'}`);
    winSeen = winSeen || res === 'win';
  }

  await page.screenshot({ path: path.join(wins, 'win_01.png'), fullPage: false }).catch(() => {});

  // Fetch a few audio urls (best effort)
  const toFetch = Array.from(audioUrls).slice(0, 12);
  for (const u of toFetch) {
    try {
      const parsed = new URL(u);
      let ext = path.extname(parsed.pathname);
      if (!ext) ext = '.mp3';
      const fname = 'audio_' + Buffer.from(u).toString('hex').slice(0, 12) + ext;
      const out = path.join(sounds, fname);
      if (fs.existsSync(out)) continue;
      const res = await page.request.get(u);
      if (!res.ok()) continue;
      const buf = Buffer.from(await res.body());
      fs.writeFileSync(out, buf);
    } catch {}
  }

  const tech = await page.evaluate(() => {
    const w = window;
    return {
      hasPIXI: !!w.PIXI,
      hasPhaser: !!w.Phaser,
      hasThree: !!w.THREE,
      hasUnity: !!w.Unity || !!w.UnityLoader,
      hasCreateJS: !!w.createjs
    };
  });

  const data = { url, settingsOpened, currency: currencyMatch ? currencyMatch[1] : null, spinResults, audioUrlsFound: toFetch, tech };
  fs.writeFileSync(path.join(outDir, 'evidence_run.json'), JSON.stringify(data, null, 2));
});
