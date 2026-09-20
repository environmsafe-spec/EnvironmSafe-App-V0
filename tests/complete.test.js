'use strict';
/* A report can only answer about an entry that carries the field the question
   is about. Salaries filed against nobody made the employee report read zero. */
const { newDevice } = require('./helpers');

module.exports = { name: 'entries a report can read', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'C');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.employees.push({ uid:newUid(), id:'EMP-1', nameEn:'Yasmeen' });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    DB.projects.push({ uid:newUid(), id:'PRJ-1', nameEn:'Go Green-1', status:'active' });
    DB.meta.company = Object.assign({}, DB.meta.company, { requireApproval:'Yes' });
    const add = (id, extra) => DB.transactions.push(Object.assign({ uid:newUid(), id,
      date:'2026-07-10', currency:'USD', fxRate:1, debit:0, credit:100, status:'Draft' }, extra));
    add('TRX-OK',      { type:'SALARY', phase:'OTHER', employeeId:'EMP-1', accountId:'ACC-9',
                         projectId:'PRJ-1', debit:100, credit:0 });
    add('TRX-NOBODY',  { type:'SALARY', phase:'OTHER', accountId:'ACC-9', projectId:'PRJ-1',
                         debit:100, credit:0 });     // the original bug: paid to nobody
    add('TRX-NOJOB',   { type:'INVOICE OUT', phase:'INVOICE OUT', customerId:'CUS-1' });
    add('TRX-QUOTE',   { type:'QUOTATION OUT', phase:'QUOTATION OUT' });  // not money yet
    CUR = 'USD'; FX_ON = false;
    save();
  });

  const miss = id => pg.evaluate(i =>
    missingFields(DB.transactions.find(x => x.id === i)), id);

  check('a salary paid to nobody is missing its employee',
        (await miss('TRX-NOBODY')).join() === 'employee', (await miss('TRX-NOBODY')).join());
  check('an invoice with no job is missing its project',
        (await miss('TRX-NOJOB')).join() === 'project', (await miss('TRX-NOJOB')).join());
  check('a complete entry is missing nothing', (await miss('TRX-OK')).length === 0);
  /* A job is asked of every entry, money or not — the office's rule, and one
     it can narrow to money alone on the Rules screen. What is asked only of
     money is not asked of a quotation. */
  check('a job is asked even of a quotation',
        (await miss('TRX-QUOTE')).join() === 'project', (await miss('TRX-QUOTE')).join());
  await pg.evaluate(() => {
    DB.meta.company = Object.assign({}, DB.meta.company,
      { rules: { project: { scope:'money', level:'require' } } });
    save();
  });
  check('and narrowing that rule to money leaves the quotation alone',
        (await miss('TRX-QUOTE')).length === 0, (await miss('TRX-QUOTE')).join());
  await pg.evaluate(() => {
    DB.meta.company = Object.assign({}, DB.meta.company, { rules: {} }); save();
  });

  // The gate is approval, never the typing.
  check('an incomplete entry cannot be approved',
        /no employee/.test(await pg.evaluate(() =>
          approvalBlocked(DB.transactions.find(x => x.id === 'TRX-NOBODY')))));
  check('and a complete one can', await pg.evaluate(() =>
          approvalBlocked(DB.transactions.find(x => x.id === 'TRX-OK'))) === '');

  /* ---- on the page ---- */
  await pg.goto(ctx.appUrl + '#/approvals'); await pg.waitForTimeout(800);
  const labels = await pg.evaluate(() =>
    [...document.querySelectorAll('[data-ap]')].map(b => b.textContent.trim()).sort().join('|'));
  check('the queue says what each one still needs',
        labels === 'Approve|Needs employee|Needs project', labels);

  // The office is asked to confirm before a batch of money is approved; the
  // test must answer that question the way a person would.
  pg.once('dialog', d => d.accept());
  const before = await pg.evaluate(() =>
    DB.transactions.filter(x => x.status === 'Approved').length);
  await pg.locator('button:has-text("Approve all")').click(); await pg.waitForTimeout(300);
  const after = await pg.evaluate(() =>
    DB.transactions.filter(x => x.status === 'Approved').length);
  check('approving them all passes only the ones that can be read',
        after - before === 1, `${before} → ${after}`);
  check('and the rest stay waiting for someone to finish them',
        await pg.evaluate(() => pendingTxs().map(x => x.id).sort().join(',')) === 'TRX-NOBODY,TRX-NOJOB',
        await pg.evaluate(() => pendingTxs().map(x => x.id).sort().join(',')));

  // Finding them without hunting.
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(800);
  await pg.selectOption('#f_only', 'incomplete');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const shown = await pg.evaluate(() =>
    [...document.querySelectorAll('#main tbody tr')].map(r => r.children[0].textContent.trim()).sort().join(','));
  check('the transactions screen can list only what is incomplete',
        shown === 'TRX-NOBODY,TRX-NOJOB,TRX-QUOTE', shown);

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
