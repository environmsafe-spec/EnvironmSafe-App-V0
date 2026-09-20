'use strict';
/* The same record must never be counted twice.
   The live books hold 41 transactions entered once and stored twice: the same
   books were imported on two occasions before they carried uids, each import
   minted its own, and nothing matched. Every one of those amounts was counted
   again. */
const { newDevice } = require('./helpers');

const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync    = pg => pg.evaluate(() => syncNow(true));

/* One record, written exactly as the books hold it. */
const ENTRY = {
  id:'TRX-DUP-0001', date:'2026-07-12', type:'RECEIPT', phase:'OTHER',
  debit:0, credit:370, currency:'USD', refNo:'R-1', status:'Approved',
  projectId:'', customerId:'', supplierId:'', employeeId:'', accountId:'',
  notes:'2 filters LF9009', createdAt:'2026-09-18T18:26:22.392Z',
  updatedAt:'2026-09-18T18:26:22.392Z'
};
const countOf = (pg, id) => pg.evaluate(x => DB.transactions.filter(t => t.id === x).length, id);

module.exports = { name: 'duplicates — the same record twice', run: async (ctx) => {
  const A = await newDevice(ctx.browser, ctx.appUrl, 'A');
  await A.evaluate(e => { DB.transactions.push(Object.assign({ uid:newUid() }, e)); save(); }, ENTRY);

  /* A second import of books that carry no uids mints fresh ones. Nothing
     matches on identity, so the books themselves must be what matches. */
  const twin = j => A.evaluate(([e, patch]) => {
    const t = Object.assign({ uid:newUid() }, e, patch);
    mergeDb({ transactions:[t] }); save();
  }, [ENTRY, j]);

  await twin({});
  ctx.check('the same record imported again under a new uid does not double the books',
            await countOf(A, 'TRX-DUP-0001') === 1);
  await twin({});
  ctx.check('and importing it a third time still does not',
            await countOf(A, 'TRX-DUP-0001') === 1);

  /* The guard must be narrow. Two records that differ at all are two records. */
  await twin({ credit: 371 });
  ctx.check('a record differing by a single figure is still a second record',
            await countOf(A, 'TRX-DUP-0001') === 2);

  await A.evaluate(([e]) => {
    mergeDb({ transactions:[Object.assign({ uid:newUid() }, e, { id:'TRX-DUP-0002' })] }); save();
  }, [ENTRY]);
  ctx.check('the same figures entered again under their own number both stand',
            await countOf(A, 'TRX-DUP-0002') === 1 && await countOf(A, 'TRX-DUP-0001') === 2);

  /* And it must not undo what uids are for: one number, two real records. */
  await A.evaluate(() => {
    mergeDb({ transactions:[{ uid:newUid(), id:'TRX-DUP-0003', date:'2026-02-02',
      type:'INVOICE OUT', debit:0, credit:400, refNo:'FIRST', updatedAt:'2026-02-02T00:00:00Z' }] });
    mergeDb({ transactions:[{ uid:newUid(), id:'TRX-DUP-0003', date:'2026-02-02',
      type:'INVOICE OUT', debit:0, credit:400, refNo:'SECOND', updatedAt:'2026-02-02T00:00:00Z' }] });
    save();
  });
  ctx.check('two different records sharing one number both survive',
            await countOf(A, 'TRX-DUP-0003') === 2);

  /* The same thing, over sync: a twin pushed from another device. */
  const P = await newDevice(ctx.browser, ctx.cloudUrl, 'P');
  await cloudIn(P, ctx.account);
  await sync(P);
  await P.evaluate(e => { DB.transactions.push(Object.assign({ uid:newUid() }, e)); save(); }, ENTRY);
  await sync(P);

  const Q = await newDevice(ctx.browser, ctx.cloudUrl, 'Q');
  await cloudIn(Q, ctx.account);
  await sync(Q);
  ctx.check('a second device receives the record', await countOf(Q, 'TRX-DUP-0001') === 1);

  await Q.evaluate(e => {                      // what a second uid-less import leaves behind
    DB.transactions.push(Object.assign({ uid:newUid() }, e)); save();
  }, ENTRY);
  await sync(Q);                               // the twin goes up
  await sync(P);                               // and comes down here
  ctx.check('a twin arriving from another device does not double these books',
            await countOf(P, 'TRX-DUP-0001') === 1);

  const R = await newDevice(ctx.browser, ctx.cloudUrl, 'R');
  await cloudIn(R, ctx.account);
  await sync(R);
  ctx.check('a device joining afterwards receives the record once, not twice',
            await countOf(R, 'TRX-DUP-0001') === 1);

  const errs = [].concat(A.errors, P.errors, Q.errors, R.errors);
  ctx.check('no page errors', errs.length === 0, errs.join(' | '));

  await A.ctx.close(); await P.ctx.close(); await Q.ctx.close(); await R.ctx.close();
}};
