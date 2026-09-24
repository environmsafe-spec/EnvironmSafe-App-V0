'use strict';
/* 21–23 Sep 2026: the app began sending its history log, the server did not
   accept that kind of record, and the whole send was refused — every
   transaction on the phone waited two days and nothing came down either. */
const { newDevice, addInvoice, readBooks } = require('./helpers');

const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync    = pg => pg.evaluate(() => syncNow(true));

module.exports = { name: 'refused', run: async (ctx) => {
  // Guard: everything the app sends is a kind the server accepts.
  const A = await newDevice(ctx.browser, ctx.cloudUrl, 'A');
  const kinds = await A.evaluate(() => SYNC_TABLES.concat(['meta']));
  const missing = kinds.filter(k => !ctx.mock.collections.includes(k));
  ctx.check('every kind of record the app sends is accepted by the server list',
            missing.length === 0, 'not accepted: ' + missing.join());

  await cloudIn(A, ctx.account);
  await sync(A);
  const B = await newDevice(ctx.browser, ctx.cloudUrl, 'B');
  await cloudIn(B, ctx.account);
  await sync(B);

  // Stage the failure: the server stops accepting the history log.
  const saved = ctx.mock.collections.slice();
  ctx.mock.collections = saved.filter(k => k !== 'audit');
  await addInvoice(B, 'INV-FROM-B');
  await sync(B);
  await addInvoice(A, 'INV-HELD');
  await A.evaluate(() => { noteChange('create', 'transactions', { id: 'INV-HELD' }, [], 'held'); save(); });
  const r = await sync(A);
  ctx.check('a refused kind is reported, not hidden', r && /refused audit/.test(r.refused || ''), JSON.stringify(r));
  const books = await readBooks(A);
  ctx.check('the transactions still reach the cloud', [...ctx.mock.stored().values()]
    .some(x => x.collection === 'transactions' && x.data && x.data.refNo === 'INV-HELD'));
  ctx.check('and the other devices\' work still comes down', books.refs.includes('INV-FROM-B'), books.refs.join());
  const badge = await A.evaluate(() => { const b = document.getElementById('pendBtn');
    return { hidden: b.hidden, bad: b.classList.contains('bad'), text: b.textContent }; });
  ctx.check('what is held back stays announced in red', !badge.hidden && badge.bad, JSON.stringify(badge));

  // The server is put right: the held-back records go up on the next sync.
  ctx.mock.collections = saved;
  const r2 = await sync(A);
  ctx.check('once accepted, the held records are sent', r2 && !r2.refused && r2.pushed > 0, JSON.stringify(r2));
  ctx.check('and nothing is left waiting', await A.evaluate(() => pendingCount()) === 0);
  ctx.check('no uncaught errors', A.errors.length === 0 && B.errors.length === 0,
            [...A.errors, ...B.errors].slice(0, 2).join(' | '));
  await A.ctx.close(); await B.ctx.close();
}};
