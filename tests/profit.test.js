'use strict';
/* This office works cash first. Counting revenue from invoices alone read a
   profitable job as a loss, because only the spending had a document. */
const { newDevice } = require('./helpers');

module.exports = { name: 'what a job earned', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'P');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'ADRA', opening:0 });
    DB.suppliers.push({ uid:newUid(), id:'SUP-1', nameEn:'Aden Parts' });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    DB.projects.push({ uid:newUid(), id:'PRJ-1', nameEn:'ADRA-Maint-001', status:'active' });
    const add = o => { const tx = Object.assign({ uid:newUid(), id:nextId('TRX'),
      date:'2026-07-10', projectId:'PRJ-1', currency:'USD', fxRate:1, debit:0, credit:0,
      status:'Approved' }, o); DB.transactions.push(tx); return tx; };
    // Money in with no invoice behind it, and money out with no bill behind it.
    add({ type:'RECEIPT', phase:'PAYMENT', customerId:'CUS-1', accountId:'ACC-9', credit:11900.72 });
    add({ type:'EXPENSE', phase:'OTHER', accountId:'ACC-9', debit:2404.60 });
    add({ type:'PAYMENT OUT', phase:'PAYMENT', supplierId:'SUP-1', accountId:'ACC-9', debit:600 });
    CUR = 'USD'; FX_ON = false;
    save();
  });

  const fig = () => pg.evaluate(() => {
    const l = txs({ projectId:'PRJ-1' });
    return { rev: netRevenue(l), cost: netCost(l) };
  });

  let f = await fig();
  check('money received with no invoice still counts as earned',
        f.rev === 11900.72, JSON.stringify(f));
  check('money paid with no bill still counts as spent',
        f.cost === 3004.60, JSON.stringify(f));
  check('so the job reads as a profit, not a loss',
        f.rev - f.cost > 0, `${f.rev} - ${f.cost}`);

  // Once an invoice exists and the receipt is put against it, the same money
  // must be counted once, not twice.
  await pg.evaluate(() => {
    const inv = { uid:newUid(), id:'TRX-INV', date:'2026-07-01', type:'INVOICE OUT',
      phase:'INVOICE OUT', customerId:'CUS-1', projectId:'PRJ-1', currency:'USD', fxRate:1,
      debit:0, credit:11900.72, status:'Approved' };
    DB.transactions.push(inv);
    DB.transactions.find(x => x.type === 'RECEIPT').applied = [{ uid:inv.uid, amount:11900.72 }];
    save();
  });
  f = await fig();
  check('invoicing it and applying the receipt does not count it twice',
        f.rev === 11900.72, JSON.stringify(f));

  // A receipt only half applied: the invoice counts, and so does the rest.
  await pg.evaluate(() => {
    const inv = DB.transactions.find(x => x.id === 'TRX-INV');
    inv.credit = 8000;
    DB.transactions.find(x => x.type === 'RECEIPT').applied = [{ uid:inv.uid, amount:8000 }];
    save();
  });
  f = await fig();
  check('a part-applied receipt counts the invoice plus what is left over',
        Math.abs(f.rev - 11900.72) < 0.005, JSON.stringify(f));

  // The new type earns exactly as an invoice does.
  check('on call manpower services is a kind of earning',
        await pg.evaluate(() => typeOf('ON CALL MANPOWER SERVICES').flow) === 'revenue');
  check('and it is offered when typing an entry',
        await pg.evaluate(() => TXTYPES.some(x => x.v === 'ON CALL MANPOWER SERVICES')));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
