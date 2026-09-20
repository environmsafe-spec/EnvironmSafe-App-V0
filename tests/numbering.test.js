'use strict';
/* Document numbers must be unique across every device, for good.
   They were not: 62 numbers in the live books were issued twice, because each
   device counted on its own and two of them drew the same short device tag.
   The company's server now hands out blocks of numbers, and no two blocks
   overlap — while a device with no connection must still be able to work. */
const { newDevice } = require('./helpers');

const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync    = pg => pg.evaluate(() => syncNow(true));
const settle  = pg => pg.waitForTimeout(500);

/** k numbers straight from the app, exactly as entering k records would get. */
const mint = (pg, prefix, k) => pg.evaluate(([p, n]) => {
  const out = []; for (let i = 0; i < n; i++) out.push(nextId(p)); return out;
}, [prefix, k]);

const held = pg => pg.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('environmsafe.numbers')); } catch (e) { return null; }
});

const SERVER = /^TRX-\d{4}$/;                // issued by the company's counter
const OWN    = /^TRX-[A-Z0-9]{2,4}-\d{4}$/;  // counted by the device, and says so
const numOf  = id => Number(id.slice(id.lastIndexOf('-') + 1));

module.exports = { name: 'numbering', run: async (ctx) => {
  const everyNumber = [];
  const take = list => { list.forEach(x => everyNumber.push(x)); return list; };

  /* Before any company is known there is nothing to ask, so the device counts
     on its own — and marks the number as its own. */
  const A = await newDevice(ctx.browser, ctx.cloudUrl, 'A');
  const solo = take(await mint(A, 'TRX', 2));
  ctx.check('a device with no company behind it numbers on its own',
            solo.every(x => OWN.test(x)), solo.join());

  await cloudIn(A, ctx.account);
  await sync(A);
  await settle(A);
  const a = take(await mint(A, 'TRX', 5));
  ctx.check('once the company is known its counter issues the number',
            a.every(x => SERVER.test(x)), a.join());
  ctx.check('the numbers it issues run in order',
            a.every((x, i) => i === 0 || numOf(x) === numOf(a[i-1]) + 1), a.join());

  const book = await held(A);
  ctx.check('the block is written down, not merely held in memory',
            !!book && !!book.blocks.TRX && book.blocks.TRX.next === numOf(a[4]) + 1,
            JSON.stringify(book && book.blocks.TRX));

  /* A reload is an ordinary thing. It must not hand back a number already used,
     and it must not throw away the ones still reserved. */
  await A.reload();
  await A.waitForTimeout(900);
  const afterReload = take(await mint(A, 'TRX', 3));
  ctx.check('a reload carries on from where the block left off',
            numOf(afterReload[0]) === numOf(a[4]) + 1 && afterReload.every(x => SERVER.test(x)),
            afterReload.join());

  /* The failure this exists to prevent: two people entering work at once. */
  const B = await newDevice(ctx.browser, ctx.cloudUrl, 'B');
  await cloudIn(B, ctx.account);
  await sync(B);
  await settle(B);
  const b = take(await mint(B, 'TRX', 5));
  ctx.check('a second device is issued numbers of its own',
            b.every(x => SERVER.test(x)), b.join());
  const clash = b.filter(x => a.indexOf(x) >= 0 || afterReload.indexOf(x) >= 0);
  ctx.check('two devices are never issued the same number', clash.length === 0, clash.join());

  /* A device still holding numbers when a fresh block arrives must not treat
     the two as one run: everything between them was reserved by someone else. */
  const nextFree = ctx.mock.counters.TRX;      // what the server will hand out next
  await A.evaluate(() => numbersReserve('TRX'));
  const refilled = take(await mint(A, 'TRX', 3));
  ctx.check('a fresh block starts where the server says, not where the last one stopped',
            numOf(refilled[0]) === nextFree, refilled.join() + ' — server was at ' + nextFree);

  /* A counter that has never been asked for a prefix must start above every
     number the books already carry, or it reissues one. */
  await A.evaluate(() => { DB.customers.push({ id:'CUS-0900', uid:newUid(), nameEn:'High number' }); save(); });
  await sync(A);
  delete ctx.mock.counters.CUS;              // as it stands before the first ask
  await mint(A, 'CUS', 1);                   // nothing reserved yet: asks, counts its own
  await settle(A);
  const cus = (await mint(A, 'CUS', 1))[0];
  ctx.check('a counter starts above the numbers the books already carry',
            /^CUS-\d{4}$/.test(cus) && numOf(cus) === 901, cus);

  /* Work must never stop because a network did. */
  const blockSize = await B.evaluate(() => NUM_BLOCK);
  await B.ctx.setOffline(true);
  const offline = take(await mint(B, 'TRX', 30));   // more than one block holds
  ctx.check('entry keeps working with no connection',
            offline.length === 30 && offline.every(x => !!x));
  ctx.check('a device past its block says the numbers are its own',
            offline.some(x => OWN.test(x)) && offline.every(x => SERVER.test(x) || OWN.test(x)),
            offline.slice(-3).join());
  /* The number after the last one reserved belongs to whichever device asks
     next. A device cut off from the server must stop at its block's end and
     count its own from there, or it quietly takes a number that is not its. */
  const spent = b.concat(offline).filter(x => SERVER.test(x));
  ctx.check('a device never spends past the end of its block',
            spent.length <= blockSize, spent.length + ' of ' + blockSize + ': ' + spent.join());
  await B.ctx.setOffline(false);

  /* A counter that refuses is no reason to stop taking work. */
  ctx.mock.counterFails = 20;
  const C = await newDevice(ctx.browser, ctx.cloudUrl, 'C');
  await cloudIn(C, ctx.account);
  await sync(C);
  await settle(C);
  const c = take(await mint(C, 'TRX', 3));
  ctx.mock.counterFails = 0;
  ctx.check('a counter that refuses does not stop entry',
            c.length === 3 && c.every(x => OWN.test(x)), c.join());

  /* Restoring a backup brings back records whose numbers this device's own
     counter no longer remembers. None of them may be handed out again. */
  const D = await newDevice(ctx.browser, ctx.appUrl, 'D');
  const restored = await D.evaluate(() => {
    DB.transactions.push({ uid:newUid(), id:`TRX-${deviceTag()}-0007`, refNo:'RESTORED',
      date:'2026-01-01', type:'INVOICE OUT', debit:0, credit:5, currency:'YER', status:'Approved' });
    NUMBERS.own = {}; DB.meta.seq = { TRX: 6 };     // the counter as a restore leaves it
    numbersSave(); save();
    return nextId('TRX');
  });
  ctx.check('a number already on a record is never handed out again',
            OWN.test(restored) && numOf(restored) === 8, restored);

  /* Numbers reserved out of one company's counter are not another's to spend.
     Done last: it leaves this device pointed at books that are not its own. */
  const stood = await A.evaluate(() => (JSON.parse(localStorage.getItem('environmsafe.numbers')).blocks.TRX || {}).next);
  const foreign = take([await A.evaluate(() => { SYNC.companyId = 'another-company'; return nextId('TRX'); })])[0];
  ctx.check('numbers reserved for one company are not spent in another\'s books',
            OWN.test(foreign), foreign + ' — the block stood at ' + stood);

  /* The whole point, over everything this suite did. */
  ctx.check('no number was ever issued twice',
            new Set(everyNumber).size === everyNumber.length,
            everyNumber.length + ' issued, ' + new Set(everyNumber).size + ' distinct');

  const errs = [].concat(A.errors, B.errors, C.errors, D.errors);
  ctx.check('numbering raised no errors', errs.length === 0, errs.join(' | '));

  await A.ctx.close(); await B.ctx.close(); await C.ctx.close(); await D.ctx.close();
}};
