'use strict';
/* A wide table scrolls sideways on screen. Paper cannot scroll, so anything
   past the page edge was printed as nothing at all — the ledger lost Debit and
   Credit, a statement lost its Balance. These checks measure the printed width. */
const { newDevice } = require('./helpers');

/* A4 portrait at 96dpi less 10mm margins: about 718 CSS pixels of usable width. */
const PAGE_W = 718;

module.exports = { name: 'print', run: async (ctx) => {
  const ctxB = await ctx.browser.newContext({ viewport: { width: PAGE_W, height: 1000 } });
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
    DB.customers.push({ id:'CUS-1', uid:newUid(), nameEn:'Aden Trading and Contracting Company Ltd', nameAr:'', phone:'777' });
    for (let i = 1; i <= 25; i++) DB.transactions.push({ id:nextId('TRX'), uid:newUid(),
      date:'2026-08-' + String(i).padStart(2,'0'), type:'INVOICE OUT', phase:'INVOICE OUT',
      caseNo:'CASE-2026-0'+i, customerId:'CUS-1', supplierId:'', employeeId:'', projectId:'',
      accountId:'', categoryId:'', itemId:'', qty:1, unitPrice:1523456.78, discount:0, isAsset:'No',
      currency:'YER', debit:0, credit:1523456.78, status:'Approved', refNo:'INV-2026-00'+i,
      againstRef:'', docType:'Invoice', docRef:'', notes:'supply and installation works',
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    save();
  });

  for (const view of ['ledger', 'r_customer', 'r_bank']) {
    await pg.goto(ctx.appUrl + '#/' + view); await pg.waitForTimeout(900);
    await pg.emulateMedia({ media: 'print' }); await pg.waitForTimeout(300);
    const r = await pg.evaluate(w => {
      const t = document.querySelector('#main table');
      if (!t) return { none: true };
      const heads = [...t.querySelectorAll('th')]
        .map(h => ({ txt: h.textContent.trim(), right: Math.round(h.getBoundingClientRect().right) }));
      return { none:false, total: heads.length, cut: heads.filter(h => h.right > w + 1).map(h => h.txt) };
    }, PAGE_W);
    if (r.none) continue;
    ctx.check(`${view}: every column fits the page`, r.cut.length === 0,
      r.cut.length ? `${r.cut.length}/${r.total} cut: ${r.cut.join(', ')}` : `${r.total} columns`);
    await pg.emulateMedia({ media: 'screen' });
  }

  // Money must never be split across lines, nor clipped by a narrow column.
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(900);
  const screenScrolls = await pg.evaluate(() => {
    const t = document.querySelector('#main table'), w = t.closest('.tablewrap');
    return getComputedStyle(w).overflowX === 'auto' && t.scrollWidth > w.clientWidth;
  });
  ctx.check('on screen a wide table still scrolls sideways', screenScrolls);

  await pg.emulateMedia({ media: 'print' }); await pg.waitForTimeout(300);
  const money = await pg.evaluate(() => {
    const cells = [...document.querySelectorAll('#main table td.num')].filter(c => c.textContent.trim());
    return { total: cells.length,
             nowrap: cells.every(c => getComputedStyle(c).whiteSpace === 'nowrap'),
             clipped: cells.filter(c => c.scrollWidth > c.clientWidth + 1).length,
             sample: cells.length ? cells[0].textContent.trim() : '' };
  });
  ctx.check('figures cannot wrap', money.nowrap === true);
  ctx.check('no figure is clipped', money.clipped === 0, `${money.total} figures, e.g. ${money.sample}`);
  ctx.check('column headings repeat on each page',
    await pg.evaluate(() => getComputedStyle(document.querySelector('#main table').tHead).display) === 'table-header-group');

  await pg.emulateMedia({ media: 'screen' });
  const pdf = await pg.pdf({ format:'A4', printBackground:true,
                             margin:{ top:'10mm', bottom:'10mm', left:'10mm', right:'10mm' } });
  ctx.check('a printable file is produced', pdf.slice(0,5).toString('latin1') === '%PDF-', `${pdf.length} bytes`);

  ctx.check('no uncaught errors while printing', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await ctxB.close();
}};
