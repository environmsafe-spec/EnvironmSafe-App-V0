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

  /* Where it actually came from.

     A record used to be written to disk with no uid. It was given one at the
     next start-up — so between pressing Save and next opening the app it had
     no identity at all. Copy the books in that window and each copy hands out
     a different identity for the same entry; syncing then sees two records,
     because by its own rules they are two. That is precisely what happened to
     one evening's work: 62 entries, every one of them stored twice. So: no
     record reaches the disk without its identity. */
  const born = await A.evaluate(() => {
    const before = DB.transactions.length;
    document.location.hash = '#/daily';
    // Straight through the code the entry screen uses, then read the disk —
    // not the copy in memory, which is not what a second device would copy.
    DB.transactions.push({ id:nextId('TRX'), date:'2026-07-01', type:'EXPENSE',
      debit:12, credit:0, currency:'USD', status:'Approved', refNo:'NEWBORN',
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    save();
    const onDisk = JSON.parse(localStorage.getItem(DB_KEY)).transactions;
    const mine = onDisk.find(t => t.refNo === 'NEWBORN');
    return { added: onDisk.length === before + 1, uid: (mine || {}).uid || '' };
  });
  ctx.check('a record written to disk already has its identity',
            born.added && !!born.uid, JSON.stringify(born));

  const everyOne = await A.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem(DB_KEY));
    const naked = [];
    SYNC_TABLES.forEach(tbl => (saved[tbl] || []).forEach(r => {
      if (r && !r.uid) naked.push(tbl + '/' + r.id);
    }));
    return naked;
  });
  ctx.check('and so does every record the books already hold',
            everyOne.length === 0, everyOne.join(', '));

  const viaForm = await A.evaluate(async () => {
    // The screens people actually use: master data, and a purchase that
    // brings an asset onto the register.
    DB.customers.push(Object.assign({ id:nextId('CUS'), uid:newUid(),
      createdAt:new Date().toISOString() }, { nameEn:'Born named' }));
    save();
    const saved = JSON.parse(localStorage.getItem(DB_KEY));
    return (saved.customers.find(c => c.nameEn === 'Born named') || {}).uid || '';
  });
  ctx.check('a record added from a master screen is named at birth', !!viaForm, viaForm);

  /* Named at the moment it is built, before anything saves it — the backstop
     in save() is the guarantee, not the plan. */
  const atBirth = await A.evaluate(() => {
    const tx = { id:'TRX-SRC', itemId:'', supplierId:'', date:'2026-07-01',
                 qty:1, debit:100, credit:0, notes:'pump' };
    return registerAssetFrom(tx, {}).uid || '';
  });
  ctx.check('an asset is named as it is built, not as it is saved', !!atBirth, atBirth);

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
