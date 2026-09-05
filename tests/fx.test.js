'use strict';
/* The converted view and the books replacement.

   Two things are easy to get wrong and expensive to get wrong:
   money from three currencies being added together as if it were one, and a
   data replacement that also throws away the sign-ins. Both are checked here
   against the real app in a real browser. */

const { newDevice } = require('./helpers');

/** Puts one row on the books directly, so a test can state exactly what it means. */
const addRow = (pg, row) => pg.evaluate(r => {
  const tx = Object.assign({
    id: nextId('TRX'), uid: newUid(), date: '2026-05-05', type: 'EXPENSE', phase: 'OTHER',
    caseNo: '', customerId: '', supplierId: '', employeeId: '', projectId: '', accountId: '',
    categoryId: '', itemId: '', qty: 0, unitPrice: 0, discount: 0, isAsset: 'No',
    fxRate: 0, debit: 0, credit: 0, status: 'Approved', refNo: '', againstRef: '',
    docType: '', docRef: '', notes: '', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() }, r);
  DB.transactions.push(tx); save();
  return tx.id;
}, row);

const setView = (pg, cur) => pg.evaluate(c => {
  CUR = c; FX_ON = c === FXV; localStorage.setItem('environmsafe.currency', c);
  return { CUR, FX_ON };
}, cur);

const costNow = pg => pg.evaluate(() => netCost(txs()));

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'fx');

  /* ---- the standing rates ---- */
  await pg.evaluate(() => { DB.meta.fx = { USD: 1, SAR: 4, YER: 500 }; save(); });

  // 100 USD, 400 SAR and 50,000 YER of cost. At those rates that is
  // 100 + 100 + 100 = 300 USD, and nothing else.
  await addRow(pg, { currency: 'USD', debit: 100 });
  await addRow(pg, { currency: 'SAR', debit: 400 });
  await addRow(pg, { currency: 'YER', debit: 50000 });

  await setView(pg, 'USD');
  check('a single-currency view shows only that currency', await costNow(pg) === 100,
        `got ${await costNow(pg)}`);

  await setView(pg, 'SAR');
  check('switching currency switches the figures', await costNow(pg) === 400);

  await setView(pg, 'USD*');
  const converted = await costNow(pg);
  check('the converted view adds all three currencies in USD', Math.abs(converted - 300) < 0.005,
        `got ${converted}`);

  /* ---- a row that moved at its own rate ---- */
  // The same 50,000 YER, but that day the money actually changed at 250.
  await pg.evaluate(() => {
    const r = DB.transactions.find(x => x.currency === 'YER');
    r.fxRate = 250; save();
  });
  const withRow = await costNow(pg);
  check("a row's own rate beats the standing rate", Math.abs(withRow - 400) < 0.005,
        `expected 400, got ${withRow}`);

  /* ---- documents and the duplicate guard never convert ---- */
  const guard = await pg.evaluate(() => {
    // 50,000 YER entered twice on the same day is a duplicate whether or not
    // somebody happens to be looking at the USD view.
    const yer = DB.transactions.find(x => x.currency === 'YER');
    return duplicateTxWarning({ date: yer.date, type: 'EXPENSE', amount: 50000,
      refNo: '', customerId: '', supplierId: '', employeeId: '' }) !== '';
  });
  check('the duplicate guard still compares the money as entered', guard);

  /* ---- replacing the books keeps the people and the letterhead ---- */
  await pg.evaluate(() => {
    DB.meta.company = Object.assign(CO(), { name: 'EnvironmSafe Ltd', payVia: 'acct 12345' });
    save();
  });
  const before = await pg.evaluate(() => ({ users: DB.users.length, txs: DB.transactions.length }));
  const after = await pg.evaluate(() => {
    replaceBooks({ transactions: [{ id: 'TRX-9001', uid: 'x-1', date: '2026-01-01',
      type: 'EXPENSE', currency: 'USD', debit: 7, credit: 0, status: 'Approved',
      updatedAt: new Date().toISOString() }], customers: [] });
    return { users: DB.users.length, txs: DB.transactions.length,
             name: CO().name, payVia: CO().payVia, first: DB.transactions[0].id };
  });
  check('replacing the books keeps every sign-in', after.users === before.users && after.users > 0,
        `${before.users} → ${after.users}`);
  check('replacing the books keeps the company profile',
        after.name === 'EnvironmSafe Ltd' && after.payVia === 'acct 12345');
  check('replacing the books leaves only the incoming rows',
        after.txs === 1 && after.first === 'TRX-9001', `${before.txs} → ${after.txs}`);

  /* ---- a statement never mixes currencies ---- */
  // One customer, money in two currencies. Asked for "all currencies", the
  // statement must come out as two statements, not one impossible total.
  await pg.evaluate(() => {
    DB.customers.push({ id: 'CUS-T1', uid: 'cus-t1', nameEn: 'Two Currency Co', opening: 0 });
    const base = { id: '', uid: '', date: '2026-03-03', type: 'INVOICE OUT', phase: 'INVOICE OUT',
      caseNo: '', customerId: 'CUS-T1', supplierId: '', employeeId: '', projectId: '',
      accountId: '', categoryId: '', itemId: '', qty: 0, unitPrice: 0, discount: 0,
      isAsset: 'No', debit: 0, status: 'Approved', refNo: '', againstRef: '', docType: '',
      docRef: '', notes: '', updatedAt: new Date().toISOString() };
    DB.transactions.push(Object.assign({}, base, { id: nextId('TRX'), uid: newUid(),
      currency: 'USD', fxRate: 1, credit: 200 }));
    DB.transactions.push(Object.assign({}, base, { id: nextId('TRX'), uid: newUid(),
      currency: 'SAR', fxRate: 4, credit: 800 }));
    DB.meta.fx = { USD: 1, SAR: 4, YER: 500 };
    save();
  });

  const closings = async () => {
    await pg.waitForTimeout(500);
    return pg.evaluate(() => {
      const blocks = [...document.querySelectorAll('.cur-block')];
      const read = root => [...root.querySelectorAll('tfoot td')].map(x => x.textContent.trim());
      return blocks.length
        ? blocks.map(b => ({ cur: b.querySelector('.cur-head').textContent, foot: read(b) }))
        : [{ cur: '', foot: read(document) }];
    });
  };

  await pg.goto(ctx.appUrl + '#/r_customer'); await pg.waitForTimeout(800);
  await pg.selectOption('#r_ent', 'CUS-T1');
  await pg.locator('button:has-text("Run")').click(); await pg.waitForTimeout(600);

  await pg.selectOption('#curSel', '');
  const all = await closings();
  check('with no currency picked the statement splits into one section per currency',
        all.length === 2 && all.every(b => b.cur), JSON.stringify(all.map(b => b.cur)));
  const usd = all.find(b => b.cur === 'USD'), sar = all.find(b => b.cur === 'SAR');
  check('each section closes on its own money, never a mixed total',
        usd && sar && usd.foot.join().includes('200.00') && sar.foot.join().includes('800.00'),
        JSON.stringify(all));

  await pg.selectOption('#curSel', 'SAR');
  const one = await closings();
  check('picking one currency prints that statement alone',
        one.length === 1 && one[0].foot.join().includes('800.00'), JSON.stringify(one));

  await pg.selectOption('#curSel', 'USD*');
  const conv = await closings();
  // 200 USD + 800 SAR at 4 to the dollar = 400 USD, in one section.
  check('the converted statement is a single section in USD',
        conv.length === 1 && conv[0].foot.join().includes('400.00'), JSON.stringify(conv));

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'converted view & books replacement', run };
