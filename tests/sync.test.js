'use strict';
/* The reason all of this exists: a lost phone must not be a lost ledger. */
const { newDevice, addInvoice, addCustomer, readBooks } = require('./helpers');

const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync    = pg => pg.evaluate(() => syncNow(true));

module.exports = { name: 'sync', run: async (ctx) => {
  const A = await newDevice(ctx.browser, ctx.cloudUrl, 'A');
  await cloudIn(A, ctx.account);
  await addCustomer(A, 'Aden Trading');
  await addInvoice(A, 'INV-A1');
  let r = await sync(A);
  ctx.check('the first device sends its books up', r && r.pushed > 0, JSON.stringify(r));

  const B = await newDevice(ctx.browser, ctx.cloudUrl, 'B');
  await cloudIn(B, ctx.account);
  await sync(B);
  let books = await readBooks(B);
  ctx.check('a second device receives them', books.transactions === 1 && books.customers === 1,
            JSON.stringify(books.refs));

  await addInvoice(B, 'INV-B1');
  await sync(B); await sync(A);
  ctx.check('work travels back the other way',
            (await readBooks(A)).refs.join() === 'INV-A1,INV-B1');

  await A.evaluate(() => { const i = DB.transactions.findIndex(t => t.refNo === 'INV-A1');
                           DB.transactions.splice(i, 1); save(); });
  await sync(A); await sync(B);
  ctx.check('a deletion reaches the other device', (await readBooks(B)).refs.join() === 'INV-B1');
  await sync(B); await sync(A);
  ctx.check('the deleted record does not return', (await readBooks(A)).refs.join() === 'INV-B1');

  await B.ctx.setOffline(true);
  await addInvoice(B, 'INV-OFFLINE');
  ctx.check('syncing with no connection fails quietly', await sync(B) === null);
  ctx.check('work done offline is still there', (await readBooks(B)).refs.includes('INV-OFFLINE'));
  await B.ctx.setOffline(false);
  await sync(B); await sync(A);
  ctx.check('it arrives once the connection returns', (await readBooks(A)).refs.includes('INV-OFFLINE'));

  // The whole point: a replacement phone, with nothing on it.
  const C = await newDevice(ctx.browser, ctx.cloudUrl, 'C');
  ctx.check('a replacement phone starts empty', (await readBooks(C)).transactions === 0);
  await cloudIn(C, ctx.account);
  await sync(C);
  const back = await readBooks(C);
  ctx.check('a replacement phone recovers the whole ledger',
            back.transactions === 2 && back.customers === 1, JSON.stringify(back.refs));

  ctx.check('nothing is left waiting to send', await A.evaluate(() => pendingCount()) === 0);
  ctx.check('no uncaught errors', A.errors.length === 0 && B.errors.length === 0 && C.errors.length === 0,
            [...A.errors, ...B.errors, ...C.errors].slice(0,2).join(' | '));

  await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
}};
