'use strict';
/* Item/service report and Asset register extend the same column flexibility to
   a flat register shape: one row per item or asset, with a totals row rather
   than a running balance. The totals here are not contiguous with any fixed
   trailing block (Avg price sits between two summed columns in the original
   layout), so the footer sums by column id wherever the user has put it,
   rather than by pinning a tail group — this suite exists to prove that
   still adds up correctly once columns move. */
const { newDevice } = require('./helpers');

const openPicker = pg => pg.locator('.page-head button:has-text("Columns")').click();
const rowOf = (pg, label) => pg.locator('.modal > div > div').filter({ hasText: label }).first();
const mainHeaders = pg => pg.locator('#main .tablewrap').first().locator('th').allTextContents();
const mainFooter  = pg => pg.locator('#main .tablewrap').first().locator('tfoot td').allTextContents();

module.exports = { name: 'columns (items & assets)', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'columns2');

  await pg.evaluate(() => {
    DB.items.push({ id:'ITM-1', uid:newUid(), code:'IT-01', nameEn:'Steel pipe 2in', kind:'Goods',
      unit:'metre', category:'Piping', salePrice:1200, costPrice:800, notes:'galvanized' });
    DB.customers.push({ id:'CUS-1', uid:newUid(), nameEn:'Aden Trading', nameAr:'', phone:'777' });
    DB.transactions.push({ id:nextId('TRX'), uid:newUid(), date:'2026-08-10', type:'INVOICE OUT',
      phase:'INVOICE OUT', caseNo:'', customerId:'CUS-1', supplierId:'', employeeId:'', projectId:'',
      accountId:'', categoryId:'', itemId:'ITM-1', qty:10, unitPrice:1200, discount:0, isAsset:'No',
      currency:'YER', debit:0, credit:12000, status:'Approved', refNo:'INV-01', againstRef:'',
      docType:'', docRef:'', notes:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    DB.employees.push({ id:'EMP-1', uid:newUid(), nameEn:'Sara Ahmed', position:'Ops' });
    DB.suppliers.push({ id:'SUP-1', uid:newUid(), nameEn:'Gulf Supplies' });
    DB.assets.push({ id:'AST-1', uid:newUid(), tag:'A-001', nameEn:'Toyota Hilux', nameAr:'',
      category:'Vehicle', location:'Aden yard', custodianId:'EMP-1', supplierId:'SUP-1',
      acquiredOn:'2025-01-01', qty:1, cost:12000000, lifeYears:5, salvage:1000000,
      method:'Straight line', status:'Active', source:'Purchased', serial:'CH-99321' });
    save();
  });

  // ---------- Item / service report ----------
  await pg.goto(ctx.appUrl + '#/r_item'); await pg.waitForTimeout(900);
  ctx.check('the Columns button is offered on the item report',
    await pg.locator('.page-head button:has-text("Columns")').count() === 1);
  const itemDefault = await mainHeaders(pg);
  ctx.check('the default item columns match what shipped before this feature',
    itemDefault.join() ===
      'Code,Description,Type,Unit,Quoted,Qty sold,Sales value,Avg price,Qty bought,Purchase value,Margin',
    itemDefault.join());

  await openPicker(pg); await pg.waitForTimeout(300);
  await (await rowOf(pg, 'Group')).locator('input[type=checkbox]').check();
  await (await rowOf(pg, 'Catalogue selling price')).locator('input[type=checkbox]').check();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const itemAfter = await mainHeaders(pg);
  ctx.check('a catalogue field not shown before can be added',
    itemAfter.includes('Group') && itemAfter.includes('Catalogue selling price'), itemAfter.join());
  ctx.check('Code and Description still lead', itemAfter[0] === 'Code' && itemAfter[1] === 'Description');

  const footer = await mainFooter(pg);
  // Total spans the two lead columns, so the sums start at index 5 (Type,Unit,Group,Quoted,QtySold blank).
  ctx.check('the sales value total lands under Sales value, not a neighbouring column',
    footer[6] === '12,000.00', footer.join(' | '));
  ctx.check('the purchase value total is correct (no purchases recorded)', footer[9] === '0.00', footer.join(' | '));
  ctx.check('the margin total is correct', footer[11] === '12,000.00', footer.join(' | '));
  ctx.check('a non-summable column added into the middle stays blank in the footer',
    footer[10] === '', footer.join(' | '));

  // The item's own drill-down (only shown for one selected item) is a
  // different shape and was deliberately left alone by this feature.
  const before = await pg.locator('#main .card').count();
  await pg.goto(ctx.appUrl + '#/r_item'); await pg.waitForTimeout(300);
  await pg.selectOption('#r_ent', { index: 1 }).catch(() => {});
  await pg.locator('button:has-text("Run")').click(); await pg.waitForTimeout(700);
  ctx.check('the movement drill-down for a single item still renders',
    await pg.locator('h2:has-text("Movement")').count() === 1);

  // ---------- Asset register ----------
  await pg.goto(ctx.appUrl + '#/r_asset'); await pg.waitForTimeout(900);
  ctx.check('the Columns button is offered on the asset register',
    await pg.locator('.page-head button:has-text("Columns")').count() === 1);
  const assetDefault = await mainHeaders(pg);
  ctx.check('the default asset columns match what shipped before this feature',
    assetDefault.join() ===
      'Tag,Asset,Category,Location,Custodian,Acquired,Source,Cost,Life,Depn. period,Accumulated,Net book value,Status',
    assetDefault.join());

  await openPicker(pg); await pg.waitForTimeout(300);
  await (await rowOf(pg, 'Serial / chassis / plate no')).locator('input[type=checkbox]').check();
  await (await rowOf(pg, 'Supplier')).locator('input[type=checkbox]').check();
  await pg.locator('.modal button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const assetAfter = await mainHeaders(pg);
  ctx.check('a register field not shown before can be added',
    assetAfter.includes('Serial / chassis / plate no') && assetAfter.includes('Supplier'), assetAfter.join());

  const afooter = await mainFooter(pg);
  const idx = h => assetAfter.slice(2).indexOf(h);   // 2 lead columns precede the summable region
  ctx.check('the cost total lands under Cost', afooter[1 + idx('Cost')] === '12,000,000.00', afooter.join(' | '));
  ctx.check('the net book value total lands under Net book value',
    afooter[1 + idx('Net book value')] === '8,516,666.67', afooter.join(' | '));
  ctx.check('Serial, a text field, carries no total', afooter[1 + idx('Serial / chassis / plate no')] === '',
    afooter.join(' | '));

  // The "By category" breakdown is a derived summary, not the primary
  // register, and was deliberately left alone by this feature.
  ctx.check('the "By category" breakdown still renders', await pg.locator('h2:has-text("By category")').count() === 1);

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
