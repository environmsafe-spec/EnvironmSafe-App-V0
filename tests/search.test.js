'use strict';
/* Searching the ledger.

   The box read five fields, so looking for a person, an amount, a project or an
   account found nothing — which reads as "we have no such entry" rather than
   "this box does not look there". That is the worst way for a search to fail,
   because the user believes the answer. */

const { newDevice } = require('./helpers');

const setup = pg => pg.evaluate(() => {
  DB.customers.push({ id:'CUS-9', uid:'c9', nameEn:'GO GREEN' });
  DB.suppliers.push({ id:'SUP-9', uid:'s9', nameEn:'Ahmed Musa' });
  DB.employees.push({ id:'EMP-9', uid:'e9', nameEn:'Yasmeen' });
  DB.projects.push({ id:'PRJ-9', uid:'p9', nameEn:'UNHCR-GEN-001', status:'active' });
  DB.accounts.push({ id:'ACC-9', uid:'a9', nameEn:'YER-QUT', kind:'Bank', currency:'YER', opening:0 });
  DB.categories.push({ id:'CAT-9', uid:'k9', nameEn:'Zakah' });
  const row = o => Object.assign({ id:nextId('TRX'), uid:newUid(), phase:'OTHER', caseNo:'',
    customerId:'', supplierId:'', employeeId:'', projectId:'', accountId:'', categoryId:'',
    itemId:'', qty:0, unitPrice:0, discount:0, isAsset:'No', currency:'YER', fxRate:530,
    debit:0, credit:0, status:'Approved', refNo:'', againstRef:'', docType:'', docRef:'',
    notes:'', updatedAt:new Date().toISOString() }, o);
  DB.transactions.push(row({ id:'TRX-0330', sourceRef:'TRX-000333', date:'2026-05-05',
    type:'EXPENSE CLAIM', employeeId:'EMP-9', projectId:'PRJ-9', accountId:'ACC-9',
    debit:125000, notes:'transportation for the site' }));
  DB.transactions.push(row({ id:'TRX-0331', sourceRef:'TRX-000334', date:'2026-05-06',
    type:'INVOICE OUT', customerId:'CUS-9', credit:8543, currency:'SAR', fxRate:3.75,
    refNo:'INV-2026052001' }));
  DB.transactions.push(row({ id:'TRX-0332', sourceRef:'TRX-000335', date:'2026-05-07',
    type:'EXPENSE', supplierId:'SUP-9', categoryId:'CAT-9', debit:88700,
    notes:'Plastic Tank' }));
  save();
});

const find = (pg, q) => pg.evaluate(term =>
  ledgerSearch(DB.transactions, term).map(x => x.id), q);

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'search');
  await setup(pg);

  const cases = [
    ['its own number',            'TRX-0330',        ['TRX-0330']],
    ['the workbook number',       'TRX-000334',      ['TRX-0331']],
    ['the transaction type',      'expense claim',   ['TRX-0330']],
    ['a customer by name',        'go green',        ['TRX-0331']],
    ['a supplier by name',        'ahmed',           ['TRX-0332']],
    ['an employee by name',       'yasmeen',         ['TRX-0330']],
    ['a project by name',         'unhcr',           ['TRX-0330']],
    ['an account by name',        'yer-qut',         ['TRX-0330']],
    ['a category by name',        'zakah',           ['TRX-0332']],
    ['a party code',              'cus-9',           ['TRX-0331']],
    ['a debit amount as typed',   '125000',          ['TRX-0330']],
    ['a debit amount as shown',   '125,000',         ['TRX-0330']],
    ['a credit amount',           '8543',            ['TRX-0331']],
    ['a reference number',        'inv-2026052001',  ['TRX-0331']],
    ['a word in the notes',       'plastic',         ['TRX-0332']],
    ['a date',                    '2026-05-06',      ['TRX-0331']],
    ['a currency',                'sar',             ['TRX-0331']],
  ];
  for (const [what, q, want] of cases) {
    const got = await find(pg, q);
    check(`finds ${what} — “${q}”`, JSON.stringify(got) === JSON.stringify(want), got.join(', ') || 'nothing');
  }

  check('several words narrow rather than widen',
        JSON.stringify(await find(pg, 'yasmeen transportation')) === '["TRX-0330"]',
        (await find(pg, 'yasmeen transportation')).join(', ') || 'nothing');
  check('and a pair that share no row finds nothing',
        (await find(pg, 'yasmeen plastic')).length === 0);
  check('an empty search returns everything', (await find(pg, '   ')).length === 3);
  check('search ignores case', JSON.stringify(await find(pg, 'GO GreeN')) === '["TRX-0331"]');

  /* ---- on the page ---- */
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(800);
  // The transactions screen reads the whole book whatever the top bar says: a
  // day's work is rarely in one currency, and money that is on the screen must
  // be findable from the search box without anyone guessing the currency first.
  await pg.selectOption('#curSel', 'USD'); await pg.waitForTimeout(600);
  await pg.fill('#f_q', 'yasmeen');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const shown = await pg.evaluate(() => ({
    rows: [...document.querySelectorAll('tbody tr')].map(r => r.children[0].textContent.trim()),
    note: [...document.querySelectorAll('.card-note')].map(n => n.textContent).join(' ')
  }));
  check('the ledger shows only the matching row', shown.rows.join() === 'TRX-0330', shown.rows.join());
  check('and says how many of how many matched, over what is in view',
        /1 of 3 entries match/.test(shown.note), shown.note);

  // The top bar must not be able to hide a row from this screen — that is what
  // made entries look lost. A YER row stays findable while the bar says USD.
  await pg.fill('#f_q', '125000');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const yerRow = await pg.evaluate(() =>
    [...document.querySelectorAll('tbody tr')].map(r => r.children[0].textContent.trim()));
  check('a YER amount is found while the top bar says USD',
        yerRow.join() === 'TRX-0330', yerRow.join() + ' (top bar: USD)');

  // Narrowing is still possible, but only when asked for on this screen.
  await pg.fill('#f_q', '');
  await pg.selectOption('#f_cur', 'YER');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const onlyYer = await pg.evaluate(() => ({
    rows: [...document.querySelectorAll('tbody tr')].length,
    curs: [...new Set([...document.querySelectorAll('tbody tr')].map(r => r.children[7].textContent.trim()))]
  }));
  check("the screen's own currency filter still narrows",
        onlyYer.curs.join() === 'YER' && onlyYer.rows === 2, JSON.stringify(onlyYer));

  // And a list spanning currencies is footed per currency, never added up.
  await pg.selectOption('#f_cur', '');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(600);
  const feet = await pg.evaluate(() =>
    [...document.querySelectorAll('tfoot tr')].map(r => r.children[1].textContent.trim()));
  check('each currency is totalled on its own line', feet.length > 1 &&
        feet.length === new Set(feet).size, JSON.stringify(feet));

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'searching the ledger', run };
