'use strict';
/* Money owed is a question about documents. A receipt that is only subtracted
   from a total says how much, never which, and never how late. */
const { newDevice } = require('./helpers');

module.exports = { name: 'settling documents', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'S');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    const inv = (id, date, amt) => DB.transactions.push({ uid:newUid(), id, date,
      type:'INVOICE OUT', phase:'INVOICE OUT', customerId:'CUS-1', currency:'USD',
      fxRate:1, debit:0, credit:amt, status:'Approved', refNo:'INV-' + id });
    inv('TRX-1', '2026-01-10', 1000);      // oldest
    inv('TRX-2', '2026-06-20', 400);
    DB.transactions.push({ uid:newUid(), id:'TRX-9', date:'2026-07-01', type:'RECEIPT',
      phase:'PAYMENT', customerId:'CUS-1', accountId:'ACC-9', currency:'USD', fxRate:1,
      debit:0, credit:1200, status:'Approved' });
    save();
  });

  const pay = () => pg.evaluate(() => DB.transactions.find(x => x.id === 'TRX-9'));
  const state = () => pg.evaluate(() =>
    openItemsFor('customers', 'CUS-1', 'USD').map(r => [r.tx.id, r.out]));

  check('everything is open before any money is applied',
        JSON.stringify(await state()) === '[["TRX-1",1000],["TRX-2",400]]',
        JSON.stringify(await state()));
  check('and the receipt is entirely unapplied',
        await pg.evaluate(() => unappliedOf(DB.transactions.find(x => x.id === 'TRX-9'))) === 1200);

  // A payment may not settle more than it is worth.
  const tooMuch = await pg.evaluate(() => {
    const tx = DB.transactions.find(x => x.id === 'TRX-9');
    const inv1 = DB.transactions.find(x => x.id === 'TRX-1').uid;
    return allocationProblem(tx, [{ uid:inv1, amount:1300 }]);
  });
  check('a payment cannot be applied beyond what it is worth', /more than the payment is worth/.test(tooMuch), tooMuch);

  // Nor may a document be settled past its own value.
  const overInv = await pg.evaluate(() => {
    const tx = DB.transactions.find(x => x.id === 'TRX-9');
    const inv2 = DB.transactions.find(x => x.id === 'TRX-2').uid;
    return allocationProblem(tx, [{ uid:inv2, amount:500 }]);
  });
  check('a document cannot be settled past its own value', /only 400.00 still open/.test(overInv), overInv);

  // Oldest first, which is what the button does.
  await pg.evaluate(() => {
    const tx = DB.transactions.find(x => x.id === 'TRX-9');
    const u = id => DB.transactions.find(x => x.id === id).uid;
    tx.applied = [{ uid:u('TRX-1'), amount:1000 }, { uid:u('TRX-2'), amount:200 }];
    save();
  });
  check('a settled document leaves the open list', 
        JSON.stringify(await state()) === '[["TRX-2",200]]', JSON.stringify(await state()));
  check('and the part-paid one shows only what is left',
        (await pg.evaluate(() => outstandingOf(DB.transactions.find(x => x.id === 'TRX-2')))) === 200);
  check('the receipt now has nothing unapplied', (await pg.evaluate(() =>
        unappliedOf(DB.transactions.find(x => x.id === 'TRX-9')))) === 0);

  // Age is counted from the document's own date.
  const ages = await pg.evaluate(() => ({
    old: ageBucket('2026-01-10', '2026-07-01'),
    mid: ageBucket('2026-06-20', '2026-07-01'),
    now: ageBucket('2026-07-01', '2026-07-01')
  }));
  check('how late a debt is, is counted from its own date',
        ages.old === 'Over 90' && ages.mid === '1–30' && ages.now === 'Current', JSON.stringify(ages));

  // A cancelled payment must stop settling anything.
  await pg.evaluate(() => {
    DB.transactions.find(x => x.id === 'TRX-9').status = 'Cancelled'; save();
  });
  check('cancelling a payment reopens what it was paying',
        JSON.stringify(await state()) === '[["TRX-1",1000],["TRX-2",400]]', JSON.stringify(await state()));
  await pg.evaluate(() => {
    DB.transactions.find(x => x.id === 'TRX-9').status = 'Approved'; save(); render();
  });

  /* ---- on the page ---- */
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(900);
  await pg.locator('button[data-act="apply"]').first().click(); await pg.waitForTimeout(500);
  const dialog = await pg.evaluate(() => {
    const b = document.querySelector('.modal');
    return b ? { open:true, rows:b.querySelectorAll('input[data-uid]').length,
                 text:b.textContent.slice(0, 200) } : { open:false };
  });
  check('the ledger can open the money against its documents', dialog.open && dialog.rows === 2,
        JSON.stringify(dialog));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
