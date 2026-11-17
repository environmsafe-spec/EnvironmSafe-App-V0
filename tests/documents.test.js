'use strict';
/* Invoices and quotations typed on their own screen and printed on the official
   form. What must never go wrong: a document that prints one total while the
   books hold another, a line saved without its product/service record, two
   documents sharing a number, a header that stays on the phone it was typed on,
   and a printout that spills off its A4 page. */
const { newDevice } = require('./helpers');

const settle = (pg, ms) => pg.waitForTimeout(ms || 400);
const cloudIn = (pg, a) => pg.evaluate(c => cloudSignIn(c.email, c.password), a);
const sync = pg => pg.evaluate(() => syncNow(true));
const books = (pg, ref) => pg.evaluate(r => DB.transactions.filter(x => x.refNo === r)
  .map(x => ({ id:x.id, uid:x.uid, type:x.type, qty:x.qty, unitPrice:x.unitPrice, credit:x.credit,
               amount:x.amount, itemId:x.itemId, status:x.status, customerId:x.customerId })), ref);
const sheetText = pg => pg.evaluate(() => {
  const h = document.querySelector('.docsheet-host');
  return h && h.shadowRoot ? h.shadowRoot.querySelector('.sheet').innerText : '';
});
const pdfPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

module.exports = { name: 'documents', run: async (ctx) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  /* ---- words and numbers ---- */
  const A = await newDevice(ctx.browser, ctx.cloudUrl, 'A');
  await cloudIn(A, ctx.account); await sync(A); await settle(A, 500);
  const words = await A.evaluate(() => [amountInWords(3276, 'USD'), amountInWords(11922.28, 'USD'),
    amountInWords(200, 'SAR'), amountInWords(1, 'USD'), amountInWords(1000000, 'YER')]);
  ctx.check('amount in words reads as the PDFs do',
    words[0] === 'Three Thousand Two Hundred Seventy-Six US Dollars only' &&
    words[1] === 'Eleven Thousand Nine Hundred Twenty-Two US Dollars and Twenty-Eight Cents only' &&
    words[2] === 'Two Hundred Saudi Riyals only' && words[3] === 'One US Dollar only' &&
    words[4] === 'One Million Yemeni Riyals only', words.join(' | '));

  await A.evaluate(() => {
    DB.customers.push({ id:'CUS-0002', uid:newUid(), nameEn:'UNHCR', contact:'Finance', address:'Aden' });
    DB.accounts.push({ id:'ACC-0004', uid:newUid(), nameEn:'Receivables', currency:'USD' });
    save();
  });

  /* ---- a new invoice, typed through the screen ---- */
  await A.goto(ctx.cloudUrl + '#/documents'); await settle(A, 700);
  await A.locator('button:has-text("+ New invoice")').click(); await settle(A);
  const ref1 = await A.inputValue('#docForm input[name="ref"]');
  ctx.check('a new invoice is numbered INV-YYYYMMDD01', ref1 === `INV-${today}01`, ref1);
  await A.selectOption('#docForm select[name="customerId"]', 'CUS-0002'); await settle(A, 200);
  const toFilled = await A.inputValue('#docForm textarea[name="to"]');
  ctx.check('choosing the customer fills who it is addressed to', /UNHCR/.test(toFilled) && /Attn: Finance/.test(toFilled), toFilled);
  await A.fill('tr[data-i="0"] [data-f="desc"]', 'Caterpillar 200 KVA - Office generator');
  await A.fill('tr[data-i="0"] [data-f="sub"]', 'Regular service visits as per the contract procedures');
  await A.fill('tr[data-i="0"] [data-f="unit"]', 'Visit');
  await A.fill('tr[data-i="0"] [data-f="qty"]', '6');
  await A.fill('tr[data-i="0"] [data-f="price"]', '22');
  await A.locator('button:has-text("+ Add line")').click(); await settle(A, 200);
  ctx.check('adding a line keeps what was typed', (await A.inputValue('tr[data-i="0"] [data-f="price"]')) === '22');
  await A.fill('tr[data-i="1"] [data-f="desc"]', 'Corrective maintenance call-out');
  await A.fill('tr[data-i="1"] [data-f="unit"]', 'Visit');
  await A.fill('tr[data-i="1"] [data-f="qty"]', '3');
  await A.fill('tr[data-i="1"] [data-f="price"]', '350');
  await A.locator('#docForm button:has-text("Save and preview")').click(); await settle(A, 700);

  let rows = await books(A, ref1);
  ctx.check('each line is its own INVOICE OUT under the document number',
    rows.length === 2 && rows.every(r => r.type === 'INVOICE OUT' && r.customerId === 'CUS-0002' && r.status === 'Draft'),
    JSON.stringify(rows));
  ctx.check('amounts in the books are qty × price, posted to credit, amount field set',
    rows.map(r => r.credit).sort((a, b) => a - b).join() === '132,1050' && rows.every(r => r.amount === r.credit));
  const items = await A.evaluate(ids => ids.map(id => (DB.items.find(i => i.id === id) || {}).nameEn), rows.map(r => r.itemId));
  ctx.check('a line naming something new creates its product/service record', items.every(Boolean) && items.includes('Corrective maintenance call-out'), items.join(' | '));
  ctx.check('the header is kept under the number', await A.evaluate(r => !!(DB.meta.docs[r] && DB.meta.docs[r].v === 1), ref1));

  let txt = await sheetText(A);
  ctx.check('the preview shows the official form', /INVOICE/.test(txt) && txt.includes(ref1) && /USD 1,182\.00/.test(txt), txt.slice(0, 120));
  ctx.check('the amount is written out in words', txt.includes('One Thousand One Hundred Eighty-Two US Dollars only'));
  ctx.check('the verification QR is drawn once the token arrives', await A.evaluate(() => {
    const h = document.querySelector('.docsheet-host'); return !!(h && h.shadowRoot.querySelector('.qr svg path'));
  }), 'needs a signed-in device');

  /* ---- printed: exactly one A4 page ---- */
  const pdf = await A.pdf({ preferCSSPageSize: true, printBackground: true });
  ctx.check('it prints on a single A4 page', pdfPages(pdf) === 1, `${pdfPages(pdf)} page(s)`);

  /* ---- a second one the same day takes the next number ---- */
  await A.goto(ctx.cloudUrl + '#/documents'); await settle(A);
  const ref2 = await A.evaluate(() => docNextNumber('INVOICE', today()));
  ctx.check('the next invoice that day is …02', ref2 === `INV-${today}02`, ref2);
  const dupe = await A.evaluate(r => { const d = docResolve(r); d.lines.forEach(l => l.uid = ''); return docSave(d, true); }, ref1);
  ctx.check('a number already used is refused', dupe === '');

  /* ---- editing: a changed line updates its transaction, a removed one is deleted ---- */
  await A.evaluate(r => { DOCUI = Object.assign(DOCUI, { mode:'view', ref:r }); render(); }, ref1); await settle(A);
  await A.locator('.page-head button:has-text("Edit")').click(); await settle(A);
  await A.fill('tr[data-i="0"] [data-f="qty"]', '5');
  await A.locator('tr[data-i="1"] [data-del]').click(); await settle(A, 200);
  await A.locator('#docForm button:has-text("Save and preview")').click(); await settle(A, 600);
  const before = rows;
  rows = await books(A, ref1);
  ctx.check('editing keeps the same transaction for a line and changes its amount',
    rows.length === 1 && rows[0].uid === before.find(r => r.credit === 132).uid && rows[0].credit === 110, JSON.stringify(rows));

  /* ---- a correction made in the ledger shows on the paper ---- */
  await A.evaluate(r => { const x = DB.transactions.find(t => t.refNo === r); x.qty = 4; x.credit = 88; x.amount = 88; save(); render(); }, ref1);
  await settle(A);
  txt = await sheetText(A);
  ctx.check('the printout follows the books, not a stale copy', /USD 88\.00/.test(txt), (txt.match(/USD [\d,.]+/) || [''])[0]);

  /* ---- a quotation: accreditation strip, discount columns, official box ---- */
  const qref = await A.evaluate(() => {
    const d = Object.assign(docDefaults('QUOTATION', today(), byId('customers', 'CUS-0002')), {
      ref: docNextNumber('QUOTATION', today()), date: today(), customerId:'CUS-0002', currency:'USD',
      lines:[{ desc:'NEBOSH IGC', sub:'per student', unit:'Set', qty:2, price:600, discount:100 }],
      sign:'official' });
    return docSave(d, true);
  });
  ctx.check('a quotation is numbered Q-YYYYMMDD01', qref === `Q-${today}01`, qref);
  const q = await books(A, qref);
  ctx.check('quotation lines are QUOTATION OUT, net of their discount', q.length === 1 && q[0].type === 'QUOTATION OUT' && q[0].credit === 1100, JSON.stringify(q));
  await A.evaluate(r => { DOCUI = Object.assign(DOCUI, { mode:'view', ref:r }); render(); }, qref); await settle(A, 600);
  txt = await sheetText(A);
  ctx.check('discounts get their own columns and a discount line', /DISC\./.test(txt) && /\(100\.00\)/.test(txt) && /USD 1,100\.00/.test(txt));
  ctx.check('the OFFICIAL DOCUMENT box replaces the signature when chosen', /OFFICIAL DOCUMENT:/.test(txt) && !/Authorized Signature/.test(txt));
  ctx.check('quotations carry the accreditation strip', await A.evaluate(() =>
    document.querySelector('.docsheet-host').shadowRoot.querySelectorAll('.acc img').length === 6));

  /* ---- a long invoice runs over pages, not off them ---- */
  const longRef = await A.evaluate(() => {
    const lines = []; for (let i = 1; i <= 40; i++) lines.push({ desc:'Spare part number ' + i, sub:'', unit:'pcs', qty:i, price:3.5, discount:0 });
    return docSave(Object.assign(docDefaults('INVOICE', today(), null), { ref: docNextNumber('INVOICE', today()),
      date: today(), customerId:'CUS-0002', currency:'USD', to:['UNHCR'], lines }), true);
  });
  await A.evaluate(r => { DOCUI = Object.assign(DOCUI, { mode:'view', ref:r }); render(); }, longRef); await settle(A, 700);
  const longPdf = await A.pdf({ preferCSSPageSize: true, printBackground: true });
  ctx.check('a 40-line invoice prints over more than one page', pdfPages(longPdf) >= 2, `${pdfPages(longPdf)} pages`);

  /* ---- an invoice entered line by line elsewhere still opens on the form ---- */
  await A.evaluate(() => {
    DB.transactions.push({ id:nextId('TRX'), uid:newUid(), date:'2026-10-19', type:'INVOICE OUT', phase:'INVOICE OUT',
      customerId:'CUS-0002', qty:2, unitPrice:140, discount:0, credit:280, debit:0, amount:280, currency:'USD',
      refNo:'INV-2026101901', status:'Draft', description:'2-Post Vehicle Lift 2.5 Ton' });
    save();
  });
  const legacy = await A.evaluate(() => { const d = docResolve('INV-2026101901'); return d && [d.kind, d.lines.length, d.lines[0].desc, docTotalsOf(d).total]; });
  ctx.check('an invoice with no header is read from its transactions', legacy && legacy[0] === 'INVOICE' && legacy[1] === 1 &&
    legacy[2] === '2-Post Vehicle Lift 2.5 Ton' && legacy[3] === 280, JSON.stringify(legacy));
  /* ---- the purchase side: a PO and an RFQ, addressed to a supplier ---- */
  await A.evaluate(() => {
    DB.suppliers.push({ id:'SUP-0006', uid:newUid(), nameEn:'Soham Engineering', contact:'Mr. Abubakr Mohammed',
      address:'Khor Maksar, Aden', email:'commercial@soham-engineering.com' });
    save();
  });
  const toList = () => A.evaluate(() => { DOCUI = Object.assign(DOCUI, { mode:'list', draft:null }); go('documents'); render(); });
  await toList(); await settle(A, 600);
  await A.locator('button:has-text("+ New PO")').click(); await settle(A);
  const poRef = await A.inputValue('#docForm input[name="ref"]');
  ctx.check('a new PO is numbered YYYYMMDD01, as the PO forms are', poRef === `${today}01`, poRef);
  ctx.check('a PO asks for a supplier, not a customer',
    await A.locator('#docForm select[name="supplierId"]').count() === 1 && await A.locator('#docForm select[name="customerId"]').count() === 0);
  await A.selectOption('#docForm select[name="supplierId"]', 'SUP-0006'); await settle(A, 200);
  const poTo = await A.inputValue('#docForm textarea[name="to"]');
  ctx.check('choosing the supplier fills the TO block and who signs the acceptance',
    /Soham Engineering/.test(poTo) && /Attn: Mr\. Abubakr Mohammed/.test(poTo) &&
    (await A.inputValue('#docForm input[name="supSigner"]')) === 'Mr. Abubakr Mohammed', poTo);
  await A.fill('tr[data-i="0"] [data-f="desc"]', '[006153] TRAC102.11R (Nalco)');
  await A.fill('tr[data-i="0"] [data-f="sub"]', 'Water treatment chemical | 25 Kg / Can');
  await A.fill('tr[data-i="0"] [data-f="unit"]', 'Kg');
  await A.fill('tr[data-i="0"] [data-f="qty"]', '25');
  await A.fill('tr[data-i="0"] [data-f="price"]', '12.19');
  await A.fill('#docForm input[name="vatRate"]', '5');
  await A.locator('#docForm button:has-text("Save and preview")').click(); await settle(A, 700);
  const po = await A.evaluate(r => DB.transactions.filter(x => x.refNo === r).map(x => {
    const it = byId('items', x.itemId);
    return { type:x.type, supplierId:x.supplierId, customerId:x.customerId, debit:x.debit, credit:x.credit, amount:x.amount,
             cost: it && it.costPrice, sale: it && it.salePrice };
  }), poRef);
  ctx.check('PO lines are PO OUT on the supplier, debit side, with the item at its cost price',
    po.length === 1 && po[0].type === 'PO OUT' && po[0].supplierId === 'SUP-0006' && !po[0].customerId &&
    po[0].debit === 304.75 && po[0].credit === 0 && po[0].cost === 12.19 && !po[0].sale, JSON.stringify(po));
  let ptxt = await sheetText(A);
  ctx.check('the PO prints with its own title, supplier and totals',
    /PURCHASE/.test(ptxt) && /ORDER/.test(ptxt) && ptxt.includes('Soham Engineering') && /NET AMOUNT/.test(ptxt) &&
    /USD 319\.99/.test(ptxt), ptxt.slice(0, 160));
  ctx.check('every PO carries the supplier acceptance block',
    /Supplier Acceptance/.test(ptxt) && /For Soham Engineering/.test(ptxt) && /Name: Mr\. Abubakr Mohammed/.test(ptxt) &&
    /Signature & Stamp:/.test(ptxt) && /Invoice To:/.test(ptxt));
  const poPdf = await A.pdf({ preferCSSPageSize: true, printBackground: true });
  ctx.check('the PO prints on a single A4 page', pdfPages(poPdf) === 1, `${pdfPages(poPdf)} page(s)`);

  await toList(); await settle(A, 500);
  await A.locator('button:has-text("+ New RFQ")').click(); await settle(A);
  const rfqRef = await A.inputValue('#docForm input[name="ref"]');
  ctx.check('a new RFQ is numbered RFQ-YYYYMMDD01', rfqRef === `RFQ-${today}01`, rfqRef);
  await A.selectOption('#docForm select[name="supplierId"]', 'SUP-0006'); await settle(A, 200);
  await A.fill('tr[data-i="0"] [data-f="desc"]', 'Perkins genuine fuel filter');
  await A.fill('tr[data-i="0"] [data-f="unit"]', 'Ea');
  await A.fill('tr[data-i="0"] [data-f="qty"]', '4');
  await A.fill('#docForm input[name="reqTitle"]', 'Technical Requirements:');
  await A.fill('#docForm textarea[name="reqs"]', 'Genuine parts only\nPart numbers on the quotation');
  await A.locator('#docForm button:has-text("Save and preview")').click(); await settle(A, 700);
  const rq = await books(A, rfqRef);
  ctx.check('an RFQ without prices is saved, one RFQ OUT per line', rq.length === 1 && rq[0].type === 'RFQ OUT' && rq[0].amount === 0, JSON.stringify(rq));
  ptxt = await sheetText(A);
  ctx.check('the RFQ leaves prices to the supplier and asks for what the quotation must include',
    /REQUEST FOR/.test(ptxt) && /REMARKS/.test(ptxt) && /filled in by the supplier/.test(ptxt) &&
    /Please include in your quotation:/.test(ptxt) && !/0\.00/.test(ptxt) && !/Supplier Acceptance/.test(ptxt), ptxt.slice(0, 160));
  ctx.check('the numbered requirements are printed', /Technical Requirements:/.test(ptxt) && /2\. Part numbers on the quotation/.test(ptxt));
  const rfqPdf = await A.pdf({ preferCSSPageSize: true, printBackground: true });
  ctx.check('the RFQ prints on a single A4 page', pdfPages(rfqPdf) === 1, `${pdfPages(rfqPdf)} page(s)`);

  const listed = await A.evaluate(() => docList().map(d => d.ref));
  ctx.check('the list shows every invoice and quotation',
    [ref1, qref, longRef, 'INV-2026101901', poRef, rfqRef].every(r => listed.includes(r)), listed.join(', '));

  /* ---- the header travels to the other devices ---- */
  await sync(A); await settle(A, 600);
  const B = await newDevice(ctx.browser, ctx.cloudUrl, 'B');
  await cloudIn(B, ctx.account); await sync(B); await settle(B, 600);
  const onB = await B.evaluate(r => { const d = docResolve(r); return d && { to:d.to, total:docTotalsOf(d).total, sign:d.sign }; }, qref);
  ctx.check('a document typed on one device prints the same on another',
    onB && onB.to.join('|').includes('UNHCR') && onB.total === 1100 && onB.sign === 'official', JSON.stringify(onB));
  const poB = await B.evaluate(r => { const d = docResolve(r); return d && { kind:d.kind, sup:d.supplierId, signer:d.supSigner }; }, poRef);
  ctx.check('a PO header reaches the other device too',
    poB && poB.kind === 'PO' && poB.sup === 'SUP-0006' && poB.signer === 'Mr. Abubakr Mohammed', JSON.stringify(poB));

  ctx.check('no uncaught errors', !A.errors.length && !B.errors.length, A.errors.concat(B.errors).join(' | '));
  await A.ctx.close(); await B.ctx.close();
}};
