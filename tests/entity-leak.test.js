'use strict';
/* A specific customer, asset, project or account chosen on one report must not
   silently carry over and filter an unrelated one. It did: pick a customer on
   the statement, click through the sidebar to the Asset register, and it
   showed "0 assets" — not an error, just a wrong, quiet zero. Found while
   testing the item/asset column work; the report kinds share nothing else,
   so this is its own suite rather than folded into that one. */
const { newDevice } = require('./helpers');

module.exports = { name: 'report entity does not leak', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'leak');
  await pg.evaluate(() => {
    DB.customers.push({ id:'CUS-1', uid:newUid(), nameEn:'Aden Trading', nameAr:'', phone:'777' });
    DB.assets.push({ id:'AST-1', uid:newUid(), tag:'A-001', nameEn:'Toyota Hilux', cost:12000000,
      lifeYears:5, salvage:1000000, status:'Active', source:'Purchased' });
    save();
  });

  await pg.goto(ctx.appUrl + '#/r_customer'); await pg.waitForTimeout(700);
  await pg.selectOption('#r_ent', { index: 1 });
  await pg.locator('button:has-text("Run")').click(); await pg.waitForTimeout(500);
  ctx.check('a customer can be selected on the statement',
    await pg.evaluate(() => rep.entity) === 'CUS-1');

  // The normal path: a sidebar click, not that report's own Run button.
  await pg.locator('a.navbtn[href="#/r_asset"]').click(); await pg.waitForTimeout(700);
  ctx.check('the selection does not follow to an unrelated report',
    await pg.evaluate(() => rep.entity) === '');
  const kpi = await pg.locator('.kpi .v').first().textContent();
  ctx.check('the asset register shows the real asset, not a stale-filtered zero',
    kpi.trim() !== '0', 'Acquisition cost shown: ' + kpi);

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
