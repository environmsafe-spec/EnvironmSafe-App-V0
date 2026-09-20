'use strict';
/* Once figures have been reported to anyone they must stop moving, or last
   quarter's profit is whatever today happens to compute. */
const { newDevice, toasts } = require('./helpers');

module.exports = { name: 'closing a period', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'K');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    DB.projects.push({ uid:newUid(), id:'PRJ-1', nameEn:'Go Green-1', status:'active' });
    const add = (id, date, status) => DB.transactions.push({ uid:newUid(), id, date,
      type:'INVOICE OUT', phase:'INVOICE OUT', customerId:'CUS-1', projectId:'PRJ-1',
      currency:'USD', fxRate:1, debit:0, credit:100, status, refNo:'INV-' + id });
    add('TRX-JUN', '2026-06-15', 'Approved');
    add('TRX-JUL', '2026-07-15', 'Approved');
    add('TRX-WAIT', '2026-07-20', 'Draft');
    CUR = 'USD'; FX_ON = false;
    save();
  });

  const shut = d => pg.evaluate(x => { DB.meta.company =
    Object.assign({}, DB.meta.company, { lockedUpTo:x }); save(); }, d);
  const why = id => pg.evaluate(i =>
    lockProblem(DB.transactions.find(x => x.id === i)), id);

  check('nothing is closed to begin with', await why('TRX-JUN') === '');

  // The furthest safe day is the one before the earliest entry still waiting.
  await pg.evaluate(() => { DB.meta.company =
    Object.assign({}, DB.meta.company, { requireApproval:'Yes' }); save(); });
  check('the furthest safe day stops short of unfinished work',
        await pg.evaluate(() => safeLockDate()) === '2026-07-19',
        await pg.evaluate(() => safeLockDate()));

  await shut('2026-06-30');
  check('an entry inside the closed period cannot be touched',
        /closed to that day/.test(await why('TRX-JUN')), await why('TRX-JUN'));
  check('one outside it can', await why('TRX-JUL') === '');
  check('and no entry may be dated back into it',
        /cannot be dated/.test(await pg.evaluate(() => lockProblem(null, '2026-06-01'))));

  // Approving into a closed period is a change to it like any other.
  await pg.evaluate(() => {
    const x = DB.transactions.find(t => t.id === 'TRX-WAIT');
    x.date = '2026-06-20'; save();
  });
  check('a waiting entry inside it cannot be approved either',
        /closed to that day/.test(await pg.evaluate(() =>
          approvalBlocked(DB.transactions.find(x => x.id === 'TRX-WAIT')))));
  await pg.evaluate(() => {
    const x = DB.transactions.find(t => t.id === 'TRX-WAIT');
    x.date = '2026-07-20'; save();
  });

  // Applying money is judged by the payment's own day, not the invoice's.
  await pg.evaluate(() => {
    DB.transactions.push({ uid:newUid(), id:'TRX-PAY', date:'2026-07-25', type:'RECEIPT',
      phase:'PAYMENT', customerId:'CUS-1', accountId:'ACC-9', projectId:'PRJ-1',
      currency:'USD', fxRate:1, debit:0, credit:100, status:'Approved' });
    save();
  });
  check('July money may still be put against a closed June invoice',
        await why('TRX-PAY') === '', await why('TRX-PAY'));

  /* ---- on the page ---- */
  await shut('');
  await pg.goto(ctx.appUrl + '#/company'); await pg.waitForTimeout(800);
  const note = await pg.evaluate(() => document.querySelector('#main').textContent);
  check('the screen works out the furthest safe day for you',
        /furthest you could\s+close today is\s*2026-07-19/.test(note.replace(/\s+/g, ' ')),
        (note.match(/furthest[^.]{0,90}/) || [''])[0]);

  /* Sealing unfinished work is refused outright. The confirmation is answered
     yes, so the guard is the only thing that can stop it — otherwise this
     would pass merely because a dialog went unanswered. */
  pg.on('dialog', d => d.accept());
  await pg.fill('input[name="lockedUpTo"]', '2026-07-31');
  await pg.locator('#main form button[type="submit"]').first().click();
  await pg.waitForTimeout(700);
  check('closing over work still waiting is refused, even when confirmed',
        await pg.evaluate(() => lockedUpTo()) === '',
        await pg.evaluate(() => lockedUpTo()));
  check('and says how many are in the way',
        /1 entry is still waiting for approval/.test(await toasts(pg)), await toasts(pg));

  // Closing to a day that seals nothing unfinished goes through.
  await pg.fill('input[name="lockedUpTo"]', '2026-07-19');
  await pg.locator('#main form button[type="submit"]').first().click();
  await pg.waitForTimeout(700);
  check('closing to the safe day is allowed',
        await pg.evaluate(() => lockedUpTo()) === '2026-07-19',
        await pg.evaluate(() => lockedUpTo()));
  check('and the closing day itself is recorded in the history',
        await pg.evaluate(() => (DB.audit || []).some(a =>
          (a.changes || []).some(c => c.f === 'lockedUpTo' && c.to === '2026-07-19'))));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
