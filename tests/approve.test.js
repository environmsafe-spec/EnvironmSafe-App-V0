'use strict';
/* A status that changes nothing is a label, not a control. These checks are
   about whether waiting actually means waiting. */
const { newDevice } = require('./helpers');

module.exports = { name: 'approving entries', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'A');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    const add = (id, status, amt) => DB.transactions.push({ uid:newUid(), id, date:'2026-07-10',
      type:'INVOICE OUT', phase:'INVOICE OUT', customerId:'CUS-1', currency:'USD', fxRate:1,
      debit:0, credit:amt, status, refNo:'INV-' + id });
    add('TRX-A', 'Approved', 1000);
    add('TRX-D', 'Draft', 500);
    CUR = 'USD'; FX_ON = false;
    save();
  });

  const counted = () => pg.evaluate(() => txs().map(x => x.id).sort().join(','));
  const shown   = () => pg.evaluate(() => txs({ includePending:true }).map(x => x.id).sort().join(','));

  check('with approval off, a draft counts like anything else',
        await counted() === 'TRX-A,TRX-D', await counted());

  await pg.evaluate(() => { DB.meta.company = Object.assign({}, DB.meta.company,
                              { requireApproval:'Yes' }); save(); });

  check('once it is on, what is waiting stops counting',
        await counted() === 'TRX-A', await counted());
  check('but it is still visible where it can be approved',
        await shown() === 'TRX-A,TRX-D', await shown());
  check('and the queue holds exactly what is waiting',
        await pg.evaluate(() => pendingTxs().map(x => x.id).join(',')) === 'TRX-D');

  // A waiting receipt must not settle an invoice, or waiting would mean nothing.
  await pg.evaluate(() => {
    const inv = DB.transactions.find(x => x.id === 'TRX-A');
    DB.transactions.push({ uid:newUid(), id:'TRX-P', date:'2026-07-20', type:'RECEIPT',
      phase:'PAYMENT', customerId:'CUS-1', accountId:'ACC-9', currency:'USD', fxRate:1,
      debit:0, credit:1000, status:'Draft', applied:[{ uid:inv.uid, amount:1000 }] });
    save();
  });
  check('a receipt that is still waiting settles nothing',
        await pg.evaluate(() => outstandingOf(DB.transactions.find(x => x.id === 'TRX-A'))) === 1000);
  await pg.evaluate(() => { DB.transactions.find(x => x.id === 'TRX-P').status = 'Approved'; save(); });
  check('and settles it once approved',
        await pg.evaluate(() => outstandingOf(DB.transactions.find(x => x.id === 'TRX-A'))) === 0);

  // Approving records who, and when.
  await pg.evaluate(() => { approveTx(DB.transactions.find(x => x.id === 'TRX-D')); save(); });
  const passed = await pg.evaluate(() => {
    const x = DB.transactions.find(t => t.id === 'TRX-D');
    return { status:x.status, by:x.approvedBy, at:!!x.approvedAt };
  });
  check('an approval records who passed it and when',
        passed.status === 'Approved' && !!passed.by && passed.at, JSON.stringify(passed));
  check('and it counts from that moment', await counted() === 'TRX-A,TRX-D,TRX-P', await counted());

  /* ---- on the page ---- */
  await pg.goto(ctx.appUrl + '#/approvals'); await pg.waitForTimeout(800);
  check('an empty queue says so',
        /Nothing is waiting/.test(await pg.evaluate(() => document.querySelector('#main').textContent)));

  await pg.evaluate(() => { DB.transactions.find(x => x.id === 'TRX-D').status = 'Draft'; save(); render(); });
  await pg.waitForTimeout(400);
  const queue = await pg.evaluate(() => ({
    rows: document.querySelectorAll('[data-ap]').length,
    nav: (document.querySelector('[data-view="approvals"]') || {}).textContent || ''
  }));
  check('the queue lists what is waiting', queue.rows === 1, JSON.stringify(queue));
  check('and the menu says how many without anyone going to look',
        /1/.test(queue.nav), queue.nav);

  await pg.locator('[data-ap]').first().click(); await pg.waitForTimeout(500);
  check('approving from the queue makes it count',
        await counted() === 'TRX-A,TRX-D,TRX-P', await counted());

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
