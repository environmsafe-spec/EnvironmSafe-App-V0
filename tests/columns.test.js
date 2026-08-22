'use strict';
/* Customer statement, supplier statement, bank & cash, project and employee
   reports can each have their optional columns added, removed and reordered.
   Date (or the row's name) leads and, for a running-balance report, the
   amount and balance columns stay at the end — remove those and it would
   stop being that report. Printing and Excel already read whatever table is
   on screen, so they are expected to follow without any change of their own;
   this suite checks that they actually do. */
const { newDevice, addInvoice, addCustomer } = require('./helpers');

const openPicker = pg => pg.locator('.page-head button:has-text("Columns")').click();
const rowOf = (pg, label) => pg.locator('.modal > div > div').filter({ hasText: label }).first();
const headers = pg => pg.locator('#main table th').first().locator('xpath=ancestor::table[1]//th')
  .allTextContents();

module.exports = { name: 'columns', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'columns');

  await addCustomer(pg, 'Aden Trading');
  await pg.evaluate(() => { const c = DB.customers[DB.customers.length - 1];
    DB.transactions.forEach(t => t.customerId = c.id); save(); });
  await addInvoice(pg, 'INV-01', 150000);
  await pg.evaluate(() => { const c = DB.customers[DB.customers.length - 1];
    DB.transactions.forEach(t => t.customerId = c.id); save(); });

  await pg.goto(ctx.appUrl + '#/r_customer'); await pg.waitForTimeout(900);
  ctx.check('the Columns button is offered on a report that supports it',
    await pg.locator('.page-head button:has-text("Columns")').count() === 1);

  const before = await headers(pg);
  ctx.check('the default columns match what shipped before this feature',
    before.join() === 'Date,Type,Reference No,Case,Invoiced,Received / returned,Balance', before.join());

  await openPicker(pg); await pg.waitForTimeout(300);
  await (await rowOf(pg, 'Qty')).locator('input[type=checkbox]').check();
  await (await rowOf(pg, 'Unit price')).locator('input[type=checkbox]').check();
  await (await rowOf(pg, 'Case')).locator('input[type=checkbox]').uncheck();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const after = await headers(pg);
  ctx.check('a column can be added', after.includes('Qty') && after.includes('Unit price'));
  ctx.check('a column can be removed', !after.includes('Case'));
  ctx.check('Date still leads', after[0] === 'Date');
  ctx.check('Balance still trails', after[after.length - 1] === 'Balance');

  await pg.reload(); await pg.waitForTimeout(1000);
  await pg.goto(ctx.appUrl + '#/r_customer'); await pg.waitForTimeout(900);
  ctx.check('the choice survives a reload', (await headers(pg)).join() === after.join());

  // Print and Excel must reflect exactly this state — Qty and Unit price added,
  // Case removed — with no change of their own, since both already read
  // whatever table is on screen.
  const fs = require('fs');
  const [dl] = await Promise.all([
    pg.waitForEvent('download', { timeout: 12000 }),
    pg.locator('.page-head button:has-text("Download Excel")').click()
  ]);
  const xlsx = fs.readFileSync(await dl.path()).toString('latin1');
  ctx.check('the Excel file carries the added column', xlsx.includes('Qty') && xlsx.includes('Unit price'));
  ctx.check('the Excel file does not carry the removed column', !xlsx.includes('>Case<'));

  await pg.setViewportSize({ width: 718, height: 1000 });   // A4 usable width
  await pg.emulateMedia({ media: 'print' });
  const cut = await pg.evaluate(w => [...document.querySelectorAll('#main table th')]
    .filter(h => h.getBoundingClientRect().right > w + 1).map(h => h.textContent.trim()), 718);
  ctx.check('every chosen column still fits the printed page', cut.length === 0, cut.join(', '));
  await pg.emulateMedia({ media: 'screen' });

  // Reordering: bring Case back, then walk it up next to Date.
  await openPicker(pg); await pg.waitForTimeout(300);
  await (await rowOf(pg, 'Case')).locator('input[type=checkbox]').check();
  const caseRow = await rowOf(pg, 'Case');
  await caseRow.locator('button:has-text("↑")').click();
  await caseRow.locator('button:has-text("↑")').click();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const reordered = await headers(pg);
  ctx.check('a column can be moved earlier',
    reordered.indexOf('Case') < reordered.indexOf('Qty'), reordered.join());

  // Reset must restore the shipped defaults, in the shipped order.
  await openPicker(pg); await pg.waitForTimeout(300);
  await pg.locator('.modal button:has-text("Reset to default")').click();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  ctx.check('Reset to default restores the original columns',
    (await headers(pg)).join() === before.join());

  // Each report's choice is independent — changing one must not touch another.
  await pg.goto(ctx.appUrl + '#/r_customer'); await pg.waitForTimeout(700);
  await openPicker(pg); await pg.waitForTimeout(300);
  await (await rowOf(pg, 'Item')).locator('input[type=checkbox]').check();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  await pg.goto(ctx.appUrl + '#/r_supplier'); await pg.waitForTimeout(900);
  const supplierHeaders = await pg.locator('.page-head button:has-text("Columns")').count()
    ? headers(pg) : [];
  ctx.check("a different report's default columns are unaffected",
    !(await supplierHeaders).includes('Item'));

  // The other report families offer the picker too, with sensible option sets.
  await pg.evaluate(() => {
    DB.projects.push({ id:'PRJ-1', uid:newUid(), nameEn:'HQ Fitout', budget:500000, status:'active' });
    DB.employees.push({ id:'EMP-1', uid:newUid(), nameEn:'Sara Ahmed', position:'Accountant', salary:200000 });
    if (!DB.accounts.length) DB.accounts.push({ id:'ACC-1', uid:newUid(), nameEn:'Cash',
      kind:'Cash', opening:0, currency:'YER' });
    save();
  });
  for (const [route, mustHave] of [['r_bank','In'], ['r_project','Revenue'], ['r_employee','Net']]) {
    await pg.goto(ctx.appUrl + '#/' + route); await pg.waitForTimeout(900);
    const has = await pg.locator('.page-head button:has-text("Columns")').count() === 1;
    ctx.check(`${route}: the Columns button is offered`, has);
    if (has) {
      await openPicker(pg); await pg.waitForTimeout(300);
      const options = await pg.locator('.modal div > span').allTextContents();
      ctx.check(`${route}: the picker lists real columns for this report`, options.length > 0, options.join(', '));
      await pg.locator('.modal button:has-text("Cancel")').click();
      ctx.check(`${route}: this report's own amount column is always shown`,
        (await headers(pg)).includes(mustHave), (await headers(pg)).join());
    }
  }

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
