'use strict';
/* Paperwork travels with the entry: a voucher photographed on one phone must be
   openable on every other device, and must never be reachable without signing in. */
const { newDevice, readBooks } = require('./helpers');

const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync    = pg => pg.evaluate(() => syncNow(true));

module.exports = { name: 'attach', run: async (ctx) => {
  const A = await newDevice(ctx.browser, ctx.cloudUrl, 'A');
  await cloudIn(A, ctx.account);
  await sync(A);

  // An entry typed on the daily screen, with a note and a file chosen there.
  await A.evaluate(() => go('daily'));
  await A.waitForSelector('#entryForm');
  await A.selectOption('#entryForm [name=type]', 'EXPENSE CLAIM');
  await A.fill('#entryForm [name=amount]', '175');
  await A.evaluate(() => { const s = document.querySelector('#entryForm [name=accountId]');
    s.value = DB.accounts[0].id; s.dispatchEvent(new Event('change')); });
  await A.fill('#entryForm [name=refNo]', 'MAD-TEST-1');
  await A.fill('#entryForm [name=attachNote]', 'bank note: 175 YCSR EXPENSES CLAIMS');
  await A.setInputFiles('#entryForm [name=attachFiles]',
    { name: 'voucher 1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await A.click('#entryForm button[type=submit]');
  await A.waitForFunction(() => { const t = DB.transactions.find(x => x.refNo === 'MAD-TEST-1');
                                  return t && (t.attachments || []).length === 1; }, null, { timeout: 8000 });
  const tx = await A.evaluate(() => DB.transactions.find(x => x.refNo === 'MAD-TEST-1'));
  ctx.check('the note is kept on the entry', tx.attachNote === 'bank note: 175 YCSR EXPENSES CLAIMS');
  ctx.check('the file is listed on the entry', tx.attachments[0].name === 'voucher 1.pdf', JSON.stringify(tx.attachments));
  ctx.check('the file is stored under the company and the record',
            ctx.mock.objects.has('es-attachments/' + tx.attachments[0].path) &&
            tx.attachments[0].path.startsWith('company-uuid-1/transactions/' + tx.uid + '/'),
            tx.attachments[0].path);

  await sync(A);
  const B = await newDevice(ctx.browser, ctx.cloudUrl, 'B');
  await cloudIn(B, ctx.account);
  await sync(B);
  const onB = await B.evaluate(() => DB.transactions.find(x => x.refNo === 'MAD-TEST-1'));
  ctx.check('another device sees the attachment and the note',
            onB && onB.attachments.length === 1 && onB.attachNote === tx.attachNote);
  const link = await B.evaluate(a => attLink(a), onB.attachments[0]);
  ctx.check('it gets a signed link to open the file', /\/storage\/v1\/object\/sign\/es-attachments\/.+token=/.test(link), link);

  // The Files dialog: add a second file, then remove the first.
  await B.evaluate(() => go('ledger'));
  await B.evaluate(() => attDialog('transactions', DB.transactions.find(x => x.refNo === 'MAD-TEST-1')));
  await B.setInputFiles('.modal [name=attachFiles]',
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpegdata') });
  await B.click('.modal button[type=submit]');
  await B.waitForFunction(() => DB.transactions.find(x => x.refNo === 'MAD-TEST-1').attachments.length === 2,
                          null, { timeout: 8000 });
  ctx.check('the files dialog adds a file', ctx.mock.objects.size === 2);
  B.on('dialog', d => d.accept());
  await B.click('.modal [data-rm="0"]');
  await B.waitForFunction(() => DB.transactions.find(x => x.refNo === 'MAD-TEST-1').attachments.length === 1,
                          null, { timeout: 8000 });
  ctx.check('removing a file deletes it from storage', ctx.mock.objects.size === 1);
  await sync(B); await sync(A);
  const back = await A.evaluate(() => DB.transactions.find(x => x.refNo === 'MAD-TEST-1').attachments.map(a => a.name));
  ctx.check('the change reaches the first device', back.join() === 'photo.jpg', back.join());

  ctx.check('the note is searchable', await A.evaluate(() =>
    ledgerSearch(DB.transactions, 'ycsr expenses').some(x => x.refNo === 'MAD-TEST-1')));

  // Without a cloud account a file cannot be attached, and the entry says so rather than lose it.
  const C = await newDevice(ctx.browser, ctx.appUrl, 'C');
  const refused = await C.evaluate(async () => {
    try { await attUpload('transactions', { id: 'X', uid: 'u' }, new File(['x'], 'x.txt')); return false; }
    catch (e) { return /Sign in/.test(e.message); }
  });
  ctx.check('attaching without signing in is refused plainly', refused);

  ctx.check('no uncaught errors', A.errors.length === 0 && B.errors.length === 0 && C.errors.length === 0,
            [...A.errors, ...B.errors, ...C.errors].slice(0, 2).join(' | '));
  await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
}};
