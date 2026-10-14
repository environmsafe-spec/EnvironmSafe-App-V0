'use strict';
/* A purchase order or invoice goes to a supplier or customer, so it must print
   at standard business-document sizes, not the compact 9px of an internal report.
   These checks read the printed sizes in points (1pt = 4/3 CSS px). */

/* Set ES_SHOT_DIR to also save a picture of the printed purchase order. */
const SHOT_DIR = process.env.ES_SHOT_DIR;

module.exports = { name: 'docprint', run: async (ctx) => {
  const ctxB = await ctx.browser.newContext({ viewport: { width: 794, height: 1123 } });
  const pg = await ctxB.newPage();
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push(e.message));
  await pg.goto(ctx.appUrl); await pg.waitForTimeout(700);
  await pg.fill('input[type="text"], input:not([type])', 'admin');
  await pg.fill('input[type="password"]', 'EnvironmSafe@2026');
  await pg.locator('button:has-text("Sign")').first().click(); await pg.waitForTimeout(900);
  const pw = pg.locator('.modal input');
  if (await pw.count()) { await pw.nth(0).fill('Aden#2026Test'); await pw.nth(1).fill('Aden#2026Test');
    await pg.locator('.modal button:has-text("Save")').click(); await pg.waitForTimeout(900); }

  await pg.evaluate(() => {
    DB.suppliers.push({ id:'SUP-1', uid:newUid(), nameEn:'Al-Saeed Electrical Supplies', nameAr:'',
      contact:'Mohammed Al-Saeed', address:'Crater, Aden', phone:'777 000 111' });
    DB.items.push({ id:'ITM-1', uid:newUid(), nameEn:'Copper cable 4x16 mm²', unit:'m' });
    DB.items.push({ id:'ITM-2', uid:newUid(), nameEn:'Circuit breaker 63A', unit:'pcs' });
    [['ITM-1', 120, 9.5], ['ITM-2', 4, 38]].forEach(([itemId, qty, unitPrice]) =>
      DB.transactions.push({ id:nextId('TRX'), uid:newUid(), date:'2026-10-14', type:'PO OUT',
        phase:'PO OUT', caseNo:'', customerId:'', supplierId:'SUP-1', employeeId:'', projectId:'',
        accountId:'', categoryId:'', itemId, qty, unitPrice, discount:0, isAsset:'No',
        currency:'USD', debit:qty * unitPrice, credit:0, status:'Approved', refNo:'PO-2026-0001',
        againstRef:'', docType:'Purchase Order', docRef:'', notes:'',
        createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }));
    save();
  });

  await pg.goto(ctx.appUrl + '#/r_document'); await pg.waitForTimeout(900);
  await pg.emulateMedia({ media: 'print' }); await pg.waitForTimeout(300);
  const pt = await pg.evaluate(() => {
    const size = sel => { const e = document.querySelector('.doc ' + sel);
      return e ? Math.round(parseFloat(getComputedStyle(e).fontSize) * 0.75 * 10) / 10 : 0; };
    const all = [...document.querySelectorAll('.doc *')].filter(e => e.textContent.trim())
      .map(e => parseFloat(getComputedStyle(e).fontSize) * 0.75);
    return { title: size('.lh-title b'), body: size('.doc-meta p'), line: size('tbody td'),
             total: size('.totals tr:last-child td'), smallest: Math.round(Math.min(...all) * 10) / 10 };
  });
  ctx.check('purchase order title prints at 16pt or more', pt.title >= 16, `${pt.title}pt`);
  ctx.check('document body prints at 10pt or more', pt.body >= 10, `${pt.body}pt`);
  ctx.check('line items print at 10pt or more', pt.line >= 10, `${pt.line}pt`);
  ctx.check('grand total stands out from the lines', pt.total > pt.line, `${pt.total}pt`);
  ctx.check('nothing on the document prints below 8pt', pt.smallest >= 8, `${pt.smallest}pt`);
  if (SHOT_DIR) await pg.screenshot({ path: require('path').join(SHOT_DIR, 'po-print.png'), fullPage: true });

  ctx.check('no uncaught errors while printing a document', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await ctxB.close();
}};
