'use strict';
/* What the company paid a person.

   The employee report counted salaries and advances only. Nearly all the money
   that actually reaches people here is an EXPENSE carrying their name — paid to
   them, or on their behalf, for work on a project — so the report read zero
   while hundreds of thousands had gone out the door. These checks hold the line
   at "every payment that names this person is counted, and attributed to the
   job it was for". */

const { newDevice } = require('./helpers');

const setup = pg => pg.evaluate(() => {
  DB.employees.push({ id:'EMP-1', uid:'e-1', nameEn:'Mansour', position:'Engineer', salary:400 });
  DB.employees.push({ id:'EMP-2', uid:'e-2', nameEn:'Yasmeen', position:'Admin', salary:300 });
  DB.projects.push({ id:'PRJ-A', uid:'p-a', nameEn:'Go Green-14', status:'active' });
  DB.projects.push({ id:'PRJ-B', uid:'p-b', nameEn:'UNHCR-GEN-001', status:'active' });
  DB.accounts.push({ id:'ACC-1', uid:'a-1', nameEn:'Kuraimi USD', kind:'Bank', currency:'USD', opening:0 });
  const row = o => Object.assign({ id:nextId('TRX'), uid:newUid(), phase:'OTHER', caseNo:'',
    customerId:'', supplierId:'', employeeId:'', projectId:'', accountId:'ACC-1', categoryId:'',
    itemId:'', qty:0, unitPrice:0, discount:0, isAsset:'No', currency:'USD', fxRate:1,
    debit:0, credit:0, status:'Approved', refNo:'', againstRef:'', docType:'', docRef:'',
    notes:'', updatedAt:new Date().toISOString() }, o);
  // Mansour: a salary, two job expenses on two projects, and an advance
  DB.transactions.push(row({ date:'2026-03-01', type:'SALARY', employeeId:'EMP-1', debit:400, projectId:'PRJ-A' }));
  DB.transactions.push(row({ date:'2026-03-05', type:'EXPENSE', employeeId:'EMP-1', debit:150, projectId:'PRJ-A' }));
  DB.transactions.push(row({ date:'2026-03-09', type:'EXPENSE', employeeId:'EMP-1', debit:250, projectId:'PRJ-B' }));
  DB.transactions.push(row({ date:'2026-03-11', type:'ADVANCE TO EMPLOYEE', employeeId:'EMP-1', debit:90, projectId:'PRJ-B' }));
  // Mansour again: a bus fare and a hotel night he paid for and is owed back
  DB.transactions.push(row({ date:'2026-03-06', type:'EXPENSE CLAIM', employeeId:'EMP-1', debit:30, projectId:'PRJ-A', notes:'bus to site' }));
  DB.transactions.push(row({ date:'2026-03-07', type:'EXPENSE CLAIM', employeeId:'EMP-1', debit:120, projectId:'PRJ-B', notes:'hotel' }));
  // Yasmeen: one expense with no project at all
  DB.transactions.push(row({ date:'2026-03-12', type:'EXPENSE', employeeId:'EMP-2', debit:70 }));
  // an invoice that names Mansour but is money coming IN — must not count as paid to him
  DB.transactions.push(row({ date:'2026-03-13', type:'RECEIPT', employeeId:'EMP-1', credit:9999 }));
  // and an expense naming nobody
  DB.transactions.push(row({ date:'2026-03-14', type:'EXPENSE', debit:555 }));
  save();
});

const figures = (pg, id) => pg.evaluate(eid => {
  CUR = 'USD'; FX_ON = false;
  const l = txs({ employeeId: eid }).filter(paidToEmployee);
  const b = employeeBuckets(l);
  const byProject = {};
  l.forEach(x => { const k = nameOf('projects', x.projectId) || '(none)';
    byProject[k] = (byProject[k] || 0) + amountOf(x); });
  return { ...b, rows: l.length, byProject };
}, id);

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'employee');
  await setup(pg);

  const m = await figures(pg, 'EMP-1');
  check('a job expense naming the employee is counted, not ignored', m.work === 400,
        `work & expenses = ${m.work}, expected 150 + 250`);

  /* ---- money they laid out and are owed back ---- */
  check('what they were reimbursed is its own figure', m.claim === 150,
        `expense claims = ${m.claim}, expected 30 + 120`);
  check('a reimbursement is not counted as pay for the work',
        m.work === 400, `work & expenses = ${m.work}`);
  check('but it is still money the company paid out',
        m.total === 400 + 150 + 250 + 90 + 30 + 120, `total ${m.total}`);
  check('the salary is still counted separately', m.sal === 400, `salary ${m.sal}`);
  check('the debit owed back is counted and kept in its own column', m.adv === 90, `debit ${m.adv}`);

  // The office calls a recoverable payment a debit; the report must say so too,
  // or the column and the conversation are about different things.
  await pg.goto(ctx.appUrl + '#/r_employee'); await pg.waitForTimeout(800);
  await pg.selectOption('#curSel', 'USD'); await pg.waitForTimeout(600);
  const heads = await pg.evaluate(() =>
    [...document.querySelectorAll('thead th')].map(h => h.textContent.trim()));
  check('the column is headed Debit (owed back), not Advances',
        heads.includes('Debit (owed back)') && !heads.some(h => /^Advances/.test(h)),
        heads.join(' | '));
  check('the salary and advance are untouched by the new group',
        m.sal === 400 && m.adv === 90, JSON.stringify({ sal:m.sal, adv:m.adv }));
  check('money coming IN is never counted as paid to them',
        m.rows === 6, `${m.rows} rows counted, expected 6`);

  check('the spend splits by the project it was for',
        m.byProject['Go Green-14'] === 580 && m.byProject['UNHCR-GEN-001'] === 460,
        JSON.stringify(m.byProject));

  const y = await figures(pg, 'EMP-2');
  check('an employee with only expenses still reports what they were paid',
        y.total === 70 && y.work === 70, JSON.stringify({ total:y.total, work:y.work }));


  // the whole point: the report must not read zero
  await pg.goto(ctx.appUrl + '#/r_employee'); await pg.waitForTimeout(900);
  await pg.selectOption('#curSel', 'USD'); await pg.waitForTimeout(700);
  const shown = await pg.evaluate(() => {
    const cells = [...document.querySelectorAll('tbody tr')]
      .map(r => [...r.children].map(td => td.textContent.trim()));
    return cells.filter(r => r[0] === 'Mansour')[0] || [];
  });
  check('the report on screen shows the money, not zero',
        shown.join(' ').includes('1,040.00'), shown.join(' | '));

  // drill into one employee
  await pg.selectOption('#r_ent', 'EMP-1');
  await pg.locator('button:has-text("Run")').click(); await pg.waitForTimeout(800);
  const drill = await pg.evaluate(() => ({
    byProject: !!document.querySelector('h2') &&
      [...document.querySelectorAll('h2')].some(h => /paid by project/.test(h.textContent)),
    everyPayment: [...document.querySelectorAll('h2')].some(h => /every payment/.test(h.textContent)),
    projectRows: [...document.querySelectorAll('.card table tbody tr')].map(r => r.children[0].textContent.trim())
  }));
  check('choosing one employee shows the breakdown by project', drill.byProject);
  check('and lists every payment behind it', drill.everyPayment);
  check('the project breakdown names the real projects',
        drill.projectRows.includes('Go Green-14') && drill.projectRows.includes('UNHCR-GEN-001'),
        JSON.stringify(drill.projectRows));

  // Read the breakdown the app itself draws — a payment filed under no project
  // must still appear, or money quietly vanishes from the employee's total.
  await pg.goto(ctx.appUrl + '#/r_employee'); await pg.waitForTimeout(800);
  await pg.selectOption('#curSel', 'USD'); await pg.waitForTimeout(500);
  await pg.selectOption('#r_ent', 'EMP-2');
  await pg.locator('button:has-text("Run")').click(); await pg.waitForTimeout(800);
  const noProj = await pg.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find(c => /paid by project/.test((c.querySelector('h2') || {}).textContent || ''));
    if (!card) return { rows: [], foot: '' };
    return { rows: [...card.querySelectorAll('tbody tr')]
               .map(r => [...r.children].map(td => td.textContent.trim())),
             foot: [...card.querySelectorAll('tfoot td')].map(td => td.textContent.trim()).join(' ') };
  });
  check('a payment with no project still appears in the breakdown',
        noProj.rows.some(r => /no project/.test(r[0]) && r.join(' ').includes('70.00')),
        JSON.stringify(noProj.rows));
  check("and the breakdown's total matches what the employee was paid",
        noProj.foot.includes('70.00'), noProj.foot);

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'what we paid each employee', run };
