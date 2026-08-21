'use strict';
/* The system as an accountant uses it: a statement that renders, exports that
   produce real files, printing that opens, and the duplicate guard. */
const { newDevice, addInvoice, addCustomer, toasts } = require('./helpers');
const fs = require('fs');

module.exports = { name: 'app', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'app');

  await addCustomer(pg, 'Test Customer');
  await pg.evaluate(() => {                       // tie the invoices to that customer
    const c = DB.customers[DB.customers.length - 1];
    DB.transactions.forEach(t => t.customerId = c.id);
    save();
  });
  await addInvoice(pg, 'INV-001', 150000);
  await addInvoice(pg, 'INV-002', 250000);
  await pg.evaluate(() => { const c = DB.customers[DB.customers.length - 1];
    DB.transactions.forEach(t => t.customerId = c.id); save(); });

  await pg.locator('a.navbtn[href="#/r_customer"]').click();
  await pg.waitForTimeout(900);
  ctx.check('customer statement opens',
    (await pg.locator('.page-head h1').textContent()).includes('Customer statement'));
  ctx.check('the statement renders a table', await pg.locator('#main table').count() > 0);

  // Download Excel must produce a genuine xlsx, not an empty or broken file.
  let dl = null;
  try {
    const [d] = await Promise.all([
      pg.waitForEvent('download', { timeout: 12000 }),
      pg.locator('.page-head button:has-text("Download Excel")').click()
    ]);
    dl = d;
  } catch (e) { /* reported below */ }
  if (dl) {
    const file = await dl.path();
    const size = file ? fs.statSync(file).size : 0;
    const zip  = file ? fs.readFileSync(file).slice(0, 2).toString('latin1') === 'PK' : false;
    ctx.check('Download Excel writes a real .xlsx', size > 0 && zip, `${size} bytes`);
  } else ctx.check('Download Excel writes a real .xlsx', false, 'no download started');

  // Printing must reach the browser dialogue when the app is in a real tab.
  const printed = await pg.evaluate(() => new Promise(res => {
    const orig = window.print; let called = false;
    window.print = () => { called = true; };
    const b = [...document.querySelectorAll('.page-head button')].find(x => x.textContent.includes('Print'));
    b.onclick();
    setTimeout(() => { window.print = orig; res(called); }, 300);
  }));
  ctx.check('Print / PDF opens the print dialogue', printed === true);

  // The duplicate guard is what stops the same bill being entered twice.
  const warn = await pg.evaluate(() => duplicateTxWarning({
    date:'2026-08-12', type:'INVOICE OUT', amount:150000, refNo:'',
    customerId: DB.transactions[0].customerId, supplierId:'', employeeId:'' }));
  ctx.check('a near-duplicate entry is questioned', warn.length > 0, (warn.split('\n')[1] || '').slice(0, 60));
  const clean = await pg.evaluate(() => duplicateTxWarning({
    date:'2026-08-12', type:'INVOICE OUT', amount:999999, refNo:'',
    customerId:'nobody', supplierId:'', employeeId:'' }));
  ctx.check('an unrelated entry is not questioned', clean === '');

  // Every screen is a real link, which is what allows a second tab.
  const nav = await pg.evaluate(() => {
    const a = [...document.querySelectorAll('a.navbtn')];
    return { n: a.length, all: a.every(x => (x.getAttribute('href') || '').startsWith('#/')) };
  });
  ctx.check('every sidebar entry is a real link', nav.n > 0 && nav.all, `${nav.n} screens`);

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0, 2).join(' | '));
  await pg.ctx.close();
}};
