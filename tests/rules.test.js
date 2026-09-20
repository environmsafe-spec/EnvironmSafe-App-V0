'use strict';
/* These were decided in the code, which meant every change to how this office
   works was a change somebody else had to make. They are settings now. */
const { newDevice } = require('./helpers');

module.exports = { name: 'rules the office sets', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'R');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    DB.customers.push({ uid:newUid(), id:'CUS-1', nameEn:'Go Green', opening:0 });
    DB.accounts.push({ uid:newUid(), id:'ACC-9', nameEn:'USD-Kur', currency:'USD', opening:0 });
    DB.projects.push({ uid:newUid(), id:'PRJ-1', nameEn:'Go Green-1', status:'active' });
    const add = (id, o) => DB.transactions.push(Object.assign({ uid:newUid(), id,
      date:'2026-07-10', currency:'USD', fxRate:1, debit:0, credit:100, status:'Draft' }, o));
    add('TRX-FULL',  { type:'RECEIPT', phase:'PAYMENT', customerId:'CUS-1',
                       accountId:'ACC-9', projectId:'PRJ-1' });
    add('TRX-NOJOB', { type:'RECEIPT', phase:'PAYMENT', customerId:'CUS-1', accountId:'ACC-9' });
    add('TRX-MOVE',  { type:'TRANSFER IN', phase:'OTHER', accountId:'ACC-9', projectId:'PRJ-1' });
    add('TRX-QUOTE', { type:'QUOTATION OUT', phase:'QUOTATION OUT' });
    save();
  });

  const miss = id => pg.evaluate(i => missingFields(DB.transactions.find(x => x.id === i)), id);
  const weak = id => pg.evaluate(i => weakFields(DB.transactions.find(x => x.id === i)), id);
  const setRule = (k, scope, level) => pg.evaluate(a => {
    const r = Object.assign({}, (DB.meta.company || {}).rules || {});
    r[a.k] = { scope:a.scope, level:a.level };
    DB.meta.company = Object.assign({}, DB.meta.company, { rules:r });
    save();
  }, { k, scope, level });

  /* ---- as shipped ---- */
  check('a complete entry is short of nothing', (await miss('TRX-FULL')).length === 0);
  check('an entry with no job is refused', (await miss('TRX-NOJOB')).join() === 'project');
  check('a job is asked of every entry, money or not',
        (await miss('TRX-QUOTE')).join() === 'project', (await miss('TRX-QUOTE')).join());
  check('naming somebody is mentioned, not refused, so transfers still pass',
        (await miss('TRX-MOVE')).length === 0 &&
        (await weak('TRX-MOVE')).join() === 'customer, supplier or employee',
        JSON.stringify({ miss: await miss('TRX-MOVE'), weak: await weak('TRX-MOVE') }));

  /* ---- the office changes its mind ---- */
  await setRule('anyParty', 'money', 'require');
  check('making it a refusal holds the transfer back',
        (await miss('TRX-MOVE')).join() === 'customer, supplier or employee',
        (await miss('TRX-MOVE')).join());

  await setRule('anyParty', 'money', 'off');
  check('turning it off asks nothing at all',
        (await miss('TRX-MOVE')).length === 0 && (await weak('TRX-MOVE')).length === 0);

  await setRule('project', 'money', 'require');
  check('narrowing a rule to money leaves a quotation alone',
        (await miss('TRX-QUOTE')).length === 0, (await miss('TRX-QUOTE')).join());
  check('and still refuses money with no job',
        (await miss('TRX-NOJOB')).join() === 'project');

  await setRule('reference', 'money', 'require');
  check('a rule that was off can be turned on',
        (await miss('TRX-FULL')).join() === 'reference number', (await miss('TRX-FULL')).join());
  await setRule('reference', 'money', 'off');

  /* ---- the screen ---- */
  await pg.goto(ctx.appUrl + '#/rules'); await pg.waitForTimeout(800);
  const shown = await pg.evaluate(() => ({
    rules: document.querySelectorAll('#main tbody tr').length,
    counts: [...document.querySelectorAll('#main tbody tr')].map(r =>
      r.children[3].textContent.trim())
  }));
  check('every rule is listed with what it costs today',
        shown.rules === 7, JSON.stringify(shown.rules));
  check('and the count of entries breaking one is real',
        shown.counts.some(c => c !== '—'), JSON.stringify(shown.counts));

  await pg.selectOption('select[name="level_category"]', 'require');
  await pg.locator('#main form button[type="submit"]').click(); await pg.waitForTimeout(600);
  check('a rule changed on the screen takes effect',
        (await miss('TRX-FULL')).join() === 'expense category', (await miss('TRX-FULL')).join());
  check('and the change is recorded in the history',
        await pg.evaluate(() => (DB.audit || []).some(a => a.recId === 'RULES')));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
