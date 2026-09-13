'use strict';
/* Asking one question instead of six.

   "What did we pay these two people, on that project, salaries and advances
   only, in these currencies" is a single question. Answering it by running six
   reports and adding them up is how arithmetic mistakes get made. Every
   dimension is a multiple choice, and choosing nothing means all of it — so an
   untouched report must still read exactly as it did before. */

const { newDevice } = require('./helpers');

const setup = pg => pg.evaluate(() => {
  DB.employees.push({ id:'E1', uid:'e1', nameEn:'Mansour' });
  DB.employees.push({ id:'E2', uid:'e2', nameEn:'Badr' });
  DB.employees.push({ id:'E3', uid:'e3', nameEn:'Wael' });
  DB.projects.push({ id:'P1', uid:'p1', nameEn:'Go Green', status:'active' });
  DB.projects.push({ id:'P2', uid:'p2', nameEn:'UNHCR', status:'active' });
  DB.accounts.push({ id:'AU', uid:'au', nameEn:'USD acct', kind:'Bank', currency:'USD', opening:0 });
  DB.accounts.push({ id:'AS', uid:'as', nameEn:'SAR acct', kind:'Bank', currency:'SAR', opening:0 });
  const row = o => Object.assign({ id:nextId('TRX'), uid:newUid(), phase:'OTHER', caseNo:'',
    customerId:'', supplierId:'', employeeId:'', projectId:'', accountId:'AU', categoryId:'',
    itemId:'', qty:0, unitPrice:0, discount:0, isAsset:'No', currency:'USD', fxRate:1,
    debit:0, credit:0, status:'Approved', refNo:'', againstRef:'', docType:'', docRef:'',
    notes:'', updatedAt:new Date().toISOString() }, o);
  //               employee project  type                  USD
  DB.transactions.push(row({ date:'2026-03-01', type:'SALARY',              employeeId:'E1', projectId:'P1', debit:100 }));
  DB.transactions.push(row({ date:'2026-03-02', type:'EXPENSE',             employeeId:'E1', projectId:'P1', debit:200 }));
  DB.transactions.push(row({ date:'2026-03-03', type:'EXPENSE',             employeeId:'E1', projectId:'P2', debit:400 }));
  DB.transactions.push(row({ date:'2026-03-04', type:'ADVANCE TO EMPLOYEE', employeeId:'E2', projectId:'P1', debit:800 }));
  DB.transactions.push(row({ date:'2026-03-05', type:'EXPENSE',             employeeId:'E3', projectId:'P2', debit:1600 }));
  // the same shape again in SAR, so currency really has to be doing work
  DB.transactions.push(row({ date:'2026-03-06', type:'SALARY', employeeId:'E1', projectId:'P1',
                             accountId:'AS', currency:'SAR', fxRate:4, debit:3000 }));
  DB.meta.fx = { USD:1, SAR:4, YER:500 };
  save();
});

/** Total the employee report would show, under whatever filters are set. */
const totalPaid = (pg, sel, cur) => pg.evaluate(([s, c]) => {
  rep = { from:'', to:'', entity:'', sel: s };
  CUR = c; FX_ON = (c === FXV);
  return rowsOf('employees').reduce((acc, e) => acc +
    employeeBuckets(txs({ employeeId:e.id }).filter(paidToEmployee).filter(selOk)).total, 0);
}, [sel, cur]);

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'filters');
  await setup(pg);

  check('choosing nothing covers everything, exactly as before',
        await totalPaid(pg, {}, 'USD') === 100 + 200 + 400 + 800 + 1600,
        String(await totalPaid(pg, {}, 'USD')));

  check('one employee', await totalPaid(pg, { employee:['E1'] }, 'USD') === 700,
        String(await totalPaid(pg, { employee:['E1'] }, 'USD')));
  check('two employees at once, added together',
        await totalPaid(pg, { employee:['E1','E2'] }, 'USD') === 1500,
        String(await totalPaid(pg, { employee:['E1','E2'] }, 'USD')));

  check('one project', await totalPaid(pg, { project:['P2'] }, 'USD') === 2000,
        String(await totalPaid(pg, { project:['P2'] }, 'USD')));
  check('two projects is the same as all of them here',
        await totalPaid(pg, { project:['P1','P2'] }, 'USD') === 3100);

  check('a single type — salaries only',
        await totalPaid(pg, { type:['SALARY'] }, 'USD') === 100,
        String(await totalPaid(pg, { type:['SALARY'] }, 'USD')));
  check('salaries and advances together',
        await totalPaid(pg, { type:['SALARY','ADVANCE TO EMPLOYEE'] }, 'USD') === 900,
        String(await totalPaid(pg, { type:['SALARY','ADVANCE TO EMPLOYEE'] }, 'USD')));

  // the question from the brief: these people, that project, these types
  check('several choices narrow together, not separately',
        await totalPaid(pg, { employee:['E1','E2'], project:['P1'],
                              type:['SALARY','ADVANCE TO EMPLOYEE'] }, 'USD') === 900,
        String(await totalPaid(pg, { employee:['E1','E2'], project:['P1'],
                              type:['SALARY','ADVANCE TO EMPLOYEE'] }, 'USD')));

  /* ---- currency ---- */
  check('currency chosen on the toolbar filters the money too',
        await totalPaid(pg, { currency:['SAR'] }, '') === 3000,
        String(await totalPaid(pg, { currency:['SAR'] }, '')));
  check('and in the converted view every chosen currency is translated',
        Math.abs(await totalPaid(pg, {}, 'USD*') - (3100 + 3000 / 4)) < 0.005,
        String(await totalPaid(pg, {}, 'USD*')));

  /* ---- the report on screen ---- */
  await pg.evaluate(() => { rep = { from:'', to:'', entity:'', sel:{} }; });
  await pg.goto(ctx.appUrl + '#/r_employee'); await pg.waitForTimeout(800);
  const buttons = await pg.locator('.toolbar button').allTextContents();
  check('the toolbar offers a picker for each dimension',
        ['Employees','Projects','Types','Currencies'].every(l =>
          buttons.some(b => b.startsWith(l + ':'))), buttons.join(' | '));
  check('and each one says "All" until it is used',
        buttons.filter(b => /: All$/.test(b)).length >= 4, buttons.join(' | '));

  await pg.locator('.toolbar button:has-text("Employees:")').click();
  await pg.waitForTimeout(400);
  const picker = await pg.evaluate(() => ({
    rows: document.querySelectorAll('.modal input[type=checkbox]').length,
    hasSearch: !!document.querySelector('.modal input[type=search]'),
    hasAll: [...document.querySelectorAll('.modal button')].some(b => b.textContent === 'All'),
    hasNone: [...document.querySelectorAll('.modal button')].some(b => b.textContent === 'None')
  }));
  check('the picker lists every employee, with search, All and None',
        picker.rows === 3 && picker.hasSearch && picker.hasAll && picker.hasNone,
        JSON.stringify(picker));

  // search narrows the list, and All then takes only what is shown
  await pg.fill('.modal input[type=search]', 'mans'); await pg.waitForTimeout(300);
  check('search narrows the list',
        await pg.evaluate(() => document.querySelectorAll('.modal input[type=checkbox]').length) === 1);
  await pg.locator('.modal button:has-text("All")').click();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(700);
  const after = await pg.evaluate(() => ({ chosen: selOf('employee'),
    label: [...document.querySelectorAll('.toolbar button')]
             .map(b => b.textContent).find(x => x.startsWith('Employees:')) }));
  check('"All" while searching takes only what the search showed',
        after.chosen.length === 1 && after.chosen[0] === 'E1', JSON.stringify(after.chosen));
  check('the button then names the choice instead of saying All',
        after.label === 'Employees: Mansour', after.label);

  const printed = await pg.evaluate(() =>
    (document.querySelector('.printhead .lh-title span') || {}).textContent || '');
  check('a filtered report says on the page that it is filtered',
        /Employees: Mansour/.test(printed), printed);

  const cleared = await pg.evaluate(() => {
    [...document.querySelectorAll('.toolbar button')]
      .find(b => b.textContent === 'Clear filters').click();
    return selAny();
  });
  check('Clear filters puts everything back', cleared === false);

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'choosing many, or all', run };
