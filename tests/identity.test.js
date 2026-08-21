'use strict';
/* Two devices must never be able to claim the same record. Before uids, both
   reached TRX-0005 from their own counters and merging lost one of two real
   invoices. */
const { newDevice, addInvoice } = require('./helpers');

module.exports = { name: 'identity', run: async (ctx) => {
  const A = await newDevice(ctx.browser, ctx.appUrl, 'A');
  const B = await newDevice(ctx.browser, ctx.appUrl, 'B');

  const a = await addInvoice(A, 'INV-A');
  const b = await addInvoice(B, 'INV-B');
  ctx.check('two devices mint different uids', a.uid !== b.uid);
  ctx.check('two devices mint different document numbers', a.id !== b.id, `${a.id} vs ${b.id}`);

  const backupB = await B.evaluate(() => JSON.stringify(DB));
  const merged  = await A.evaluate(j => { mergeDb(JSON.parse(j)); save();
    return DB.transactions.map(t => t.refNo).sort().join(); }, backupB);
  ctx.check('merging keeps both invoices', merged === 'INV-A,INV-B', merged);

  // A backup written before uids existed must merge once and stay merged.
  const legacy = JSON.stringify({ transactions: [{ id:'TRX-0001', date:'2026-01-01',
    type:'EXPENSE', debit:5, credit:0, refNo:'OLD-1', updatedAt:'2026-01-01T00:00:00Z' }] });
  const once  = await A.evaluate(j => { mergeDb(JSON.parse(j)); save(); return DB.transactions.length; }, legacy);
  const twice = await A.evaluate(j => { mergeDb(JSON.parse(j)); save(); return DB.transactions.length; }, legacy);
  ctx.check('an old backup merges', once === 3, 'records=' + once);
  ctx.check('merging the same old backup twice adds nothing', twice === once, 'records=' + twice);

  /* The case uids exist for. Records written before device tags all carry a
     plain number such as TRX-0005, and two devices can also draw the same
     two-character tag. Same number, different records: both must survive. */
  const collide = uid => JSON.stringify({ transactions: [{ id:'TRX-0005', uid,
    date:'2026-02-02', type:'INVOICE OUT', debit:0, credit:400, refNo:'REF-' + uid,
    updatedAt:'2026-02-02T00:00:00Z' }] });
  const before = await A.evaluate(() => DB.transactions.length);
  await A.evaluate(j => { mergeDb(JSON.parse(j)); save(); }, collide('uid-from-phone-1'));
  await A.evaluate(j => { mergeDb(JSON.parse(j)); save(); }, collide('uid-from-phone-2'));
  const after = await A.evaluate(() => ({
    n: DB.transactions.length,
    refs: DB.transactions.filter(t => t.id === 'TRX-0005').map(t => t.refNo).sort().join()
  }));
  ctx.check('two different records sharing one number both survive',
    after.n === before + 2 && after.refs === 'REF-uid-from-phone-1,REF-uid-from-phone-2',
    `${before} -> ${after.n}; ${after.refs}`);

  const next = await A.evaluate(() => nextId('TRX'));
  ctx.check('the number counter moves past what arrived', /^TRX-[A-Z0-9]{1,4}-\d{4}$/.test(next), next);

  await A.ctx.close(); await B.ctx.close();
}};
