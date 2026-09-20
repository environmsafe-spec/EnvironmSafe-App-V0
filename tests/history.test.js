'use strict';
/* An argument about the numbers comes down to who made it that, and when. */
const { newDevice } = require('./helpers');

module.exports = { name: 'the history', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'H');
  const check = ctx.check.bind(ctx);

  const log = () => pg.evaluate(() => (DB.audit || []).map(a => ({
    action:a.action, table:a.table, recId:a.recId, by:a.by,
    changes:(a.changes || []).map(c => `${c.f}:${c.from}>${c.to}`) })));

  check('nothing is recorded before anything happens', (await log()).length === 0);

  // Typing an entry
  await pg.goto(ctx.appUrl + '#/daily'); await pg.waitForTimeout(700);
  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    save();
  });
  await pg.evaluate(() => {
    const tx = { uid:newUid(), id:nextId('TRX'), date:'2026-07-10', type:'INVOICE OUT',
      phase:'INVOICE OUT', customerId:'CUS-1', currency:'USD', fxRate:1, debit:0, credit:900,
      status:'Approved', refNo:'INV-900' };
    DB.transactions.push(tx);
    noteChange('create', 'transactions', tx, [], `${tx.type} ${fmt(rawAmount(tx))} USD`);
    save();
  });
  let l = await log();
  check('adding an entry is recorded, with who added it',
        l.length === 1 && l[0].action === 'create' && !!l[0].by, JSON.stringify(l));

  // Changing it — only what actually changed, with both values
  await pg.evaluate(() => {
    const tx = DB.transactions[DB.transactions.length - 1];
    const before = JSON.parse(JSON.stringify(tx));
    tx.credit = 950; tx.notes = 'agreed by phone'; tx.updatedAt = new Date().toISOString();
    noteChange('change', 'transactions', tx, fieldsChanged(before, tx));
    save();
  });
  l = await log();
  const ch = l[1].changes.sort().join('|');
  check('a change records the field, the old value and the new',
        ch === 'credit:900>950|notes:>agreed by phone', ch);
  check('and nothing that merely got re-saved', !/updatedAt/.test(ch), ch);

  // A change that changes nothing writes nothing
  await pg.evaluate(() => {
    const tx = DB.transactions[DB.transactions.length - 1];
    noteChange('change', 'transactions', tx, fieldsChanged(tx, tx));
    save();
  });
  check('a save that changed nothing records nothing', (await log()).length === 2);

  // Approving
  await pg.evaluate(() => {
    const tx = DB.transactions[DB.transactions.length - 1];
    tx.status = 'Draft';
    approveTx(tx); save();
  });
  l = await log();
  check('an approval is recorded as its own kind of act',
        l[2].action === 'approve' && l[2].changes.join() === 'status:Draft>Approved',
        JSON.stringify(l[2]));

  // Renaming a project — the thing that quietly changes every report
  await pg.evaluate(() => {
    const prj = { uid:newUid(), id:'PRJ-1', nameEn:'Go Green-1', status:'active' };
    DB.projects.push(prj);
    noteChange('create', 'projects', prj, []);
    const before = JSON.parse(JSON.stringify(prj));
    prj.nameEn = 'Go Green-1 Filters';
    noteChange('change', 'projects', prj, fieldsChanged(before, prj));
    save();
  });
  l = await log();
  check('renaming a record is recorded like money is',
        l[4].table === 'projects' && l[4].changes.join() === 'nameEn:Go Green-1>Go Green-1 Filters',
        JSON.stringify(l[4]));

  // A password must never reach the history, in any form.
  await pg.evaluate(() => {
    const u = { uid:newUid(), id:'USR-T', nameEn:'Tester', username:'tester',
                pw:'s1:secrethash', salt:'saltysalt', role:'Data Entry' };
    DB.users.push(u);
    noteChange('create', 'users', u, fieldsChanged(null, u).filter(c => !['pw','salt'].includes(c.f)));
    save();
  });
  const dump = await pg.evaluate(() => JSON.stringify(DB.audit));
  check('a password never reaches the history',
        !/secrethash/.test(dump) && !/saltysalt/.test(dump));

  /* ---- on the page ---- */
  await pg.goto(ctx.appUrl + '#/history'); await pg.waitForTimeout(800);
  const page = await pg.evaluate(() => ({
    rows: document.querySelectorAll('#main tbody tr').length,
    text: document.querySelector('#main').textContent
  }));
  check('the history screen lists what happened', page.rows === 6, JSON.stringify(page.rows));
  check('and shows a change as old to new', /900 → 950/.test(page.text.replace(/\s+/g, ' ')),
        page.text.slice(0, 160));

  await pg.fill('#h_q', 'projects');
  await pg.locator('.toolbar button:has-text("Apply")').click(); await pg.waitForTimeout(500);
  const narrowed = await pg.evaluate(() => document.querySelectorAll('#main tbody tr').length);
  check('searching narrows it', narrowed === 2, String(narrowed));

  /* The checks above prove the differ. This one proves the app: an ordinary
     edit through the screen the office uses must leave a line behind without
     anything in the test asking it to. */
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(900);
  const was = (await log()).length;
  await pg.locator('button[data-act="edit"]').first().click(); await pg.waitForTimeout(600);
  await pg.fill('.modal input[name="amount"]', '1234');
  await pg.locator('.modal button:has-text("Save")').first().click(); await pg.waitForTimeout(700);
  const after = await log();
  const last = after[after.length - 1];
  check('editing through the screen records itself, unprompted',
        after.length === was + 1 && last.action === 'change' &&
        last.changes.some(c => /^credit:950>1234$/.test(c)),
        JSON.stringify(last));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
