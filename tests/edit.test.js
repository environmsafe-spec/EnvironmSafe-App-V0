'use strict';
/* Editing a transaction that is already on the books.

   The edit form used to offer seven fields, so a row whose customer, project or
   account was wrong could only be deleted and typed again. It now offers all of
   them — which means every rule the entry screen enforces has to hold here too,
   or the books drift apart one correction at a time. */

const { newDevice } = require('./helpers');

const setup = pg => pg.evaluate(() => {
  DB.accounts.push({ id:'ACC-U', uid:'a-u', nameEn:'Kuraimi USD', kind:'Bank', currency:'USD', opening:0 });
  DB.accounts.push({ id:'ACC-Y', uid:'a-y', nameEn:'Quataibi YER', kind:'Bank', currency:'YER', opening:0 });
  DB.customers.push({ id:'CUS-1', uid:'c-1', nameEn:'Go Green' });
  DB.suppliers.push({ id:'SUP-1', uid:'s-1', nameEn:'Ahmed Musa' });
  DB.projects.push({ id:'PRJ-1', uid:'pr-1', nameEn:'Go Green-14- ABB', status:'active' });
  DB.projects.push({ id:'PRJ-2', uid:'pr-2', nameEn:'UNHCR-GEN-001', status:'active' });
  DB.transactions.push({ id:'TRX-E1', uid:'e-1', date:'2026-04-04', type:'EXPENSE',
    phase:'OTHER', caseNo:'', customerId:'', supplierId:'SUP-1', employeeId:'', projectId:'PRJ-1',
    accountId:'ACC-U', categoryId:'', itemId:'', qty:0, unitPrice:0, discount:0, isAsset:'No',
    currency:'USD', fxRate:1, debit:500, credit:0, status:'Approved', refNo:'V-9',
    againstRef:'', docType:'', docRef:'', notes:'first', updatedAt:'2026-04-04T00:00:00.000Z' });
  DB.meta.fx = { USD:1, SAR:3.75, YER:530 };
  save();
});

/** Opens the row's edit modal and reports which fields it offers. */
async function openEdit(pg, appUrl) {
  await pg.goto(appUrl + '#/ledger');
  await pg.waitForTimeout(800);
  const btn = pg.locator('button[data-act="edit"][data-id="TRX-E1"]');
  if (!(await btn.count())) throw new Error('no Edit button for TRX-E1 on the ledger');
  await btn.first().click();
  await pg.waitForTimeout(500);
  return pg.evaluate(() => [...document.querySelectorAll('.modal [name]')].map(e => e.name));
}

/** Fills the open modal and submits it. */
const submit = (pg, vals) => pg.evaluate(v => {
  const form = document.querySelector('.modal form');
  Object.entries(v).forEach(([k, val]) => { if (form[k]) form[k].value = val; });
  form.requestSubmit ? form.requestSubmit() : form.querySelector('[type=submit]').click();
}, vals);

const row = pg => pg.evaluate(() => DB.transactions.find(x => x.id === 'TRX-E1'));

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'edit');
  pg.on('dialog', d => d.accept());              // accept the duplicate warning if it appears
  await setup(pg);

  const fields = await openEdit(pg, ctx.appUrl);
  const want = ['date','type','phase','caseNo','customerId','supplierId','employeeId',
                'projectId','accountId','categoryId','itemId','qty','unitPrice','discount',
                'amount','currency','fxRate','isAsset','status','refNo','againstRef',
                'docType','docRef','notes'];
  const missing = want.filter(k => !fields.includes(k));
  check('the edit form offers every field the entry screen does', missing.length === 0,
        missing.length ? 'missing: ' + missing.join(', ') : `${fields.length} fields`);

  // the thing the user could not do before: move a row to another project and customer
  await submit(pg, { projectId:'PRJ-2', customerId:'CUS-1' });
  await pg.waitForTimeout(400);
  let r = await row(pg);
  check('a transaction can be moved to another project and customer',
        r.projectId === 'PRJ-2' && r.customerId === 'CUS-1', `${r.projectId} / ${r.customerId}`);
  check('and the edit is stamped so it reaches the other devices',
        r.updatedAt > '2026-04-04T00:00:00.000Z');

  // changing the type must move the money to the other column
  await openEdit(pg, ctx.appUrl);
  await submit(pg, { type:'INVOICE OUT' });
  await pg.waitForTimeout(400);
  r = await row(pg);
  check('changing the type moves the money to the column that type posts to',
        r.type === 'INVOICE OUT' && r.credit === 500 && r.debit === 0,
        `debit ${r.debit} credit ${r.credit}`);

  // changing the account must change the currency with it
  await openEdit(pg, ctx.appUrl);
  await submit(pg, { accountId:'ACC-Y' });
  await pg.waitForTimeout(400);
  r = await row(pg);
  check('choosing another account brings its currency with it',
        r.accountId === 'ACC-Y' && r.currency === 'YER', `${r.accountId} / ${r.currency}`);

  // a cash movement still cannot be saved without an account
  await openEdit(pg, ctx.appUrl);
  await submit(pg, { type:'RECEIPT', accountId:'' });
  await pg.waitForTimeout(400);
  r = await row(pg);
  check('a cash movement is still refused without an account',
        r.type === 'INVOICE OUT' && r.accountId === 'ACC-Y', `${r.type} / ${r.accountId}`);

  // and an amount of zero is still refused
  await openEdit(pg, ctx.appUrl);
  await submit(pg, { amount:'0' });
  await pg.waitForTimeout(400);
  r = await row(pg);
  check('an amount of zero is still refused', r.credit === 500, `credit ${r.credit}`);

  /* ---- the asset register follows the edit ---- */
  await openEdit(pg, ctx.appUrl);
  await submit(pg, { type:'EXPENSE', accountId:'ACC-U', isAsset:'Yes',
                     assetTag:'GEN-77', assetLocation:'Aden store' });
  await pg.waitForTimeout(400);
  let a = await pg.evaluate(() => rowsOf('assets').find(x => x.sourceTx === 'TRX-E1'));
  check('marking a purchase as an asset puts it on the register',
        !!a && a.tag === 'GEN-77' && a.location === 'Aden store' && a.cost === 500,
        JSON.stringify(a && { tag:a.tag, cost:a.cost }));

  await openEdit(pg, ctx.appUrl);
  await submit(pg, { amount:'650' });
  await pg.waitForTimeout(400);
  a = await pg.evaluate(() => rowsOf('assets').find(x => x.sourceTx === 'TRX-E1'));
  check('correcting the amount corrects the asset cost too',
        a && a.cost === 650, JSON.stringify(a && { cost:a.cost }));
  check('and it does not add a second asset',
        (await pg.evaluate(() => rowsOf('assets').filter(x => x.sourceTx === 'TRX-E1').length)) === 1);

  await openEdit(pg, ctx.appUrl);
  await submit(pg, { isAsset:'No' });
  await pg.waitForTimeout(400);
  check('turning the asset flag off takes it back off the register',
        (await pg.evaluate(() => rowsOf('assets').filter(x => x.sourceTx === 'TRX-E1').length)) === 0);

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'editing a transaction', run };
