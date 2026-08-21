'use strict';
/* Shared machinery for the test suites: a static server, a stand-in Supabase,
   and the few app gestures every suite needs (sign in, seed, read back). */

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

/* Playwright may be a local dependency or a global install; accept either. */
function playwright() {
  try { return require('playwright'); }
  catch (e) {
    for (const p of ['/opt/node22/lib/node_modules/playwright',
                     '/usr/lib/node_modules/playwright']) {
      try { return require(p); } catch (e2) { /* keep looking */ }
    }
    throw new Error('playwright not found. Run: npm install');
  }
}

const APP_SRC = path.join(__dirname, '..', 'web', 'app', 'index.html');

/** A throwaway directory holding the app, plus a copy aimed at the mock server. */
function buildFixtures(mockUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-tests-'));
  const src = fs.readFileSync(APP_SRC, 'utf8');
  fs.writeFileSync(path.join(dir, 'app.html'), src);
  const wired = src.replace(/url: "https:\/\/[a-z0-9]+\.supabase\.co"/,
                            `url: ${JSON.stringify(mockUrl)}`);
  if (wired === src) throw new Error('could not point the app at the mock server');
  fs.writeFileSync(path.join(dir, 'app-cloud.html'), wired);
  return dir;
}

function startStatic(dir, port) {
  const types = { '.html':'text/html', '.js':'application/javascript', '.json':'application/json' };
  const srv = http.createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(buf);
    });
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}

/* ---------- browser gestures ---------- */

const FIRST_RUN_PASSWORD = 'EnvironmSafe@2026';
const TEST_PASSWORD      = 'Aden#2026Test';

/** A signed-in page, standing in for one device. Its own context = its own storage. */
async function newDevice(browser, url, label) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const pg  = await ctx.newPage();
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push((label ? label + ': ' : '') + e.message));
  await pg.goto(url);
  await pg.waitForTimeout(700);
  await pg.fill('input[type="text"], input:not([type])', 'admin');
  await pg.fill('input[type="password"]', FIRST_RUN_PASSWORD);
  await pg.locator('button:has-text("Sign")').first().click();
  await pg.waitForTimeout(900);
  const pw = pg.locator('.modal input');            // first run forces a new password
  if (await pw.count()) {
    await pw.nth(0).fill(TEST_PASSWORD);
    await pw.nth(1).fill(TEST_PASSWORD);
    await pg.locator('.modal button:has-text("Save")').click();
    await pg.waitForTimeout(900);
  }
  pg.ctx = ctx;
  return pg;
}

/** Adds one customer invoice; returns what the app assigned it. */
const addInvoice = (pg, ref, amount) => pg.evaluate(([r, amt]) => {
  const tx = { id: nextId('TRX'), uid: newUid(), date: '2026-08-11', type: 'INVOICE OUT',
    phase: 'INVOICE OUT', caseNo: 'CASE-' + r, customerId: '', supplierId: '', employeeId: '',
    projectId: '', accountId: '', categoryId: '', itemId: '', qty: 1, unitPrice: amt,
    discount: 0, isAsset: 'No', currency: 'YER', debit: 0, credit: amt, status: 'Approved',
    refNo: r, againstRef: '', docType: 'Invoice', docRef: '', notes: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  DB.transactions.push(tx); save();
  return { id: tx.id, uid: tx.uid };
}, [ref, amount == null ? 1000 : amount]);

const addCustomer = (pg, name) => pg.evaluate(n => {
  DB.customers.push({ id: nextId('CUS'), uid: newUid(), nameEn: n, nameAr: '', phone: '777' });
  save();
}, name);

const readBooks = pg => pg.evaluate(() => ({
  transactions: DB.transactions.length,
  customers: DB.customers.length,
  refs: DB.transactions.map(t => t.refNo).sort()
}));

const toasts = pg => pg.locator('.toast').allTextContents().then(a => a.join(' ; ')).catch(() => '');

module.exports = { playwright, buildFixtures, startStatic, newDevice,
                   addInvoice, addCustomer, readBooks, toasts,
                   FIRST_RUN_PASSWORD, TEST_PASSWORD };
