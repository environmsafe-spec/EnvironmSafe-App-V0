'use strict';
/* Eighty-nine projects is a list nobody reads. Typing the first letters must
   narrow it, or people pick the nearest wrong thing. */
const { newDevice } = require('./helpers');

module.exports = { name: 'narrowing a list', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'N');
  const check = ctx.check.bind(ctx);

  await pg.evaluate(() => {
    ['Go Green-10 Bellows', 'Go Green-2 Filters', 'ADRA-Maint-001', 'UFD- AL ZAILEE-001-FF',
     'NADFOOD H-CON-001', 'UNHCR-GEN-001', 'YCSR-001-LPG', 'Air Moka-004 - Service Engineer',
     'RIIC-LIFT-001', 'Unity Cement-001- FF design']
      .forEach(n => DB.projects.push({ uid:newUid(), id:nextId('PRJ'), nameEn:n, status:'active' }));
    save(); render();
  });
  await pg.goto(ctx.appUrl + '#/daily'); await pg.waitForTimeout(800);

  const box = '.refpick:has(select[data-reftable="projects"]) .refsearch';
  const opts = () => pg.evaluate(() => [...document
    .querySelector('select[data-reftable="projects"]').options]
    .map(o => o.textContent).filter(x => x && !/^\+ /.test(x)));

  const all = await opts();
  check('the whole list is there before anything is typed', all.length === 10, String(all.length));
  check('a long list is given a search box', await pg.locator(box).count() === 1);

  await pg.fill(box, 'go green'); await pg.waitForTimeout(300);
  let now = await opts();
  check('typing part of a name narrows it',
        now.join('|') === 'Go Green-2 Filters|Go Green-10 Bellows', now.join('|'));

  await pg.fill(box, 'zail'); await pg.waitForTimeout(300);
  now = await opts();
  check('and narrowing to one chooses it', now.length === 1 &&
        await pg.evaluate(() => document.querySelector('select[data-reftable="projects"]').value) !== '',
        now.join('|'));

  // Records are half known by their number here, so the code must find them too.
  const code = await pg.evaluate(() =>
    DB.projects.find(p => p.nameEn === 'UNHCR-GEN-001').id);
  // Cleared first, so what comes back is what the number found and nothing
  // that merely happened to be chosen already.
  await pg.evaluate(() => { const s = document.querySelector('select[data-reftable="projects"]');
                            s.value = ''; s.dataset.prev = ''; });
  await pg.fill(box, code); await pg.waitForTimeout(300);
  now = await opts();
  check('the record number finds it as well as the name',
        now.join('|') === 'UNHCR-GEN-001', now.join('|') + ' for ' + code);

  // What is already answered must survive whatever is typed next.
  const chosen = await pg.evaluate(() =>
    document.querySelector('select[data-reftable="projects"]').value);
  await pg.fill(box, 'zzzz nothing'); await pg.waitForTimeout(300);
  check('a search that matches nothing does not unpick the answer',
        await pg.evaluate(() => document.querySelector('select[data-reftable="projects"]').value) === chosen,
        chosen);

  await pg.fill(box, ''); await pg.waitForTimeout(300);
  check('clearing the search brings the whole list back', (await opts()).length === 10);

  // Short lists are left alone.
  check('a short list is not cluttered with a search box',
        await pg.evaluate(() => {
          const s = document.querySelector('select[data-reftable="accounts"]');
          return s ? !s.closest('.refpick') : true;
        }));

  check('no page errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
