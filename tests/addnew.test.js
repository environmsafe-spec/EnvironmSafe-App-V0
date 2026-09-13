'use strict';
/* Adding what is missing without losing your place.

   Halfway through entering a payment you reach the project list and the project
   is not in it. Leaving to create it loses everything typed so far — so the
   entry gets filed against the wrong project, or against none at all. The test
   that matters most here is not that the record is created; it is that the
   half-finished form underneath survives. */

const { newDevice } = require('./helpers');

const ADD = '__addnew__';

/** Fills the open master-data modal and saves it. */
const saveModal = (pg, vals) => pg.evaluate(v => {
  const form = document.querySelector('.modal form');
  Object.entries(v).forEach(([k, val]) => { if (form[k]) form[k].value = val; });
  form.requestSubmit ? form.requestSubmit() : form.querySelector('[type=submit]').click();
}, vals);

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'addnew');
  pg.on('dialog', d => d.accept());

  await pg.goto(ctx.appUrl + '#/daily'); await pg.waitForTimeout(900);

  const offered = await pg.evaluate(() => {
    const out = {};
    document.querySelectorAll('#entryForm select[data-reftable]').forEach(s => {
      out[s.dataset.reftable] = s.options[1] ? s.options[1].text : '';
    });
    return out;
  });
  ['customers','suppliers','employees','projects','accounts','categories','items']
    .forEach(tbl => check(`the ${tbl} list offers a way to add one`,
      /^\+ /.test(offered[tbl] || ''), `${tbl}: ${offered[tbl] || '(no such list)'}`));

  /* ---- the part that matters: the form underneath survives ---- */
  await pg.evaluate(() => {
    const f = document.getElementById('entryForm');
    f.date.value = '2026-08-08';
    f.type.value = 'EXPENSE';
    f.amount.value = '777';
    f.notes.value = 'half typed, do not lose me';
    f.refNo.value = 'V-777';
  });
  const projectsBefore = await pg.evaluate(() => rowsOf('projects').length);

  await pg.selectOption('#entryForm select[data-reftable="projects"]', ADD);
  await pg.waitForTimeout(500);
  check('choosing it opens the same form the Projects screen uses',
        (await pg.locator('.modal').count()) === 1);
  check('and the list does not sit on the placeholder while the box is open',
        await pg.evaluate(() =>
          document.querySelector('#entryForm select[data-reftable="projects"]').value) !== ADD);

  await saveModal(pg, { nameEn: 'Brand New Site', status: 'active' });
  await pg.waitForTimeout(700);

  const after = await pg.evaluate(() => {
    const f = document.getElementById('entryForm');
    const sel = f.querySelector('select[data-reftable="projects"]');
    const rec = rowsOf('projects').find(p => p.nameEn === 'Brand New Site');
    return { made: !!rec, chosen: sel.value === (rec || {}).id,
             inList: [...sel.options].some(o => o.text === 'Brand New Site'),
             date: f.date.value, type: f.type.value, amount: f.amount.value,
             notes: f.notes.value, refNo: f.refNo.value,
             count: rowsOf('projects').length, modalOpen: !!document.querySelector('.modal') };
  });
  check('the new project is created', after.made);
  check('and is chosen in the list you were standing in', after.chosen);
  check('and appears in that list', after.inList);
  check('exactly one project was added', after.count === projectsBefore + 1,
        `${projectsBefore} → ${after.count}`);
  check('the box closes afterwards', !after.modalOpen);

  check('EVERYTHING typed before is still there',
        after.date === '2026-08-08' && after.type === 'EXPENSE' && after.amount === '777' &&
        after.notes === 'half typed, do not lose me' && after.refNo === 'V-777',
        JSON.stringify(after));

  /* ---- a second list of the same kind picks the new record up too ---- */
  const alsoThere = await pg.evaluate(() => {
    const all = [...document.querySelectorAll('select[data-reftable="projects"]')];
    return all.every(s => [...s.options].some(o => o.text === 'Brand New Site'));
  });
  check('every list of that kind on the page gains it', alsoThere);

  /* ---- and the placeholder can never be saved onto a record ---- */
  await pg.evaluate(() => {
    const f = document.getElementById('entryForm');
    // an expense moves money, so it needs an account before it will save at all
    const acc = f.querySelector('select[data-reftable="accounts"]');
    acc.value = rowsOf('accounts')[0].id;
    const sel = f.querySelector('select[data-reftable="suppliers"]');
    sel.value = '__addnew__';                       // force it past the guard
    f.querySelector('[type=submit]').click();
  });
  await pg.waitForTimeout(800);
  const saved = await pg.evaluate(() => {
    const tx = DB.transactions[DB.transactions.length - 1];
    return tx ? { supplierId: tx.supplierId, amount: tx.debit + tx.credit,
                  n: DB.transactions.length } : null;
  });
  check('the placeholder never reaches a saved record',
        saved && saved.supplierId === '' && saved.amount === 777, JSON.stringify(saved));

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'adding from a list', run };
