'use strict';
/* Four complaints from the office, each with a defect behind it.

   A person shown twice in a list, and their money counted twice, because the
   books hold two records under one number. Several people chosen and none of
   their payments shown. No way to read every currency as one figure except
   from the top bar. And a profitability report that gave a number with no way
   to see what was behind it. */

const { newDevice } = require('./helpers');

const setup = pg => pg.evaluate(() => {
  CUR = 'USD'; FX_ON = false;
  DB.meta.fx = { USD:1, SAR:3.75, YER:500 };
  // Wathiq is in the books twice under one number — exactly as the live books
  // hold him — plus two people with a number each.
  DB.employees.push({ id:'EMP-W', uid:'e-w1', nameEn:'Wathiq Welder', position:'Welder', salary:0 });
  DB.employees.push({ id:'EMP-W', uid:'e-w2', nameEn:'Wathiq Welder', position:'Welder', salary:0 });
  DB.employees.push({ id:'EMP-1', uid:'e-1', nameEn:'Mansour', position:'Engineer', salary:0 });
  DB.employees.push({ id:'EMP-2', uid:'e-2', nameEn:'Yasmeen', position:'Admin', salary:0 });
  DB.projects.push({ id:'PRJ-A', uid:'p-a', nameEn:'Go Green-14', status:'active' });
  DB.customers.push({ id:'CUS-1', uid:'c-1', nameEn:'Aden Trading' });
  DB.suppliers.push({ id:'SUP-1', uid:'s-1', nameEn:'Sana Steel' });
  DB.accounts.push({ id:'ACC-1', uid:'a-1', nameEn:'Kuraimi USD', kind:'Bank', currency:'USD', opening:0 });
  DB.accounts.push({ id:'ACC-2', uid:'a-2', nameEn:'Tadhamon SAR', kind:'Bank', currency:'SAR', opening:0 });
  const row = o => Object.assign({ id:nextId('TRX'), uid:newUid(), phase:'OTHER', caseNo:'',
    customerId:'', supplierId:'', employeeId:'', projectId:'PRJ-A', accountId:'ACC-1', categoryId:'',
    itemId:'', qty:0, unitPrice:0, discount:0, isAsset:'No', currency:'USD', fxRate:0,
    debit:0, credit:0, status:'Approved', refNo:'', againstRef:'', docType:'', docRef:'',
    notes:'', updatedAt:new Date().toISOString() }, o);
  DB.transactions.push(row({ date:'2026-03-01', type:'SALARY', employeeId:'EMP-W', debit:100, refNo:'W-1' }));
  DB.transactions.push(row({ date:'2026-03-02', type:'EXPENSE', employeeId:'EMP-1', debit:40, refNo:'M-1' }));
  DB.transactions.push(row({ date:'2026-03-03', type:'EXPENSE', employeeId:'EMP-2', debit:25, refNo:'Y-1' }));
  // The job: one invoice raised, one receipt nothing was raised for, one
  // supplier payment with no bill behind it.
  DB.transactions.push(row({ date:'2026-03-04', type:'INVOICE OUT', customerId:'CUS-1', credit:1000, refNo:'INV-1' }));
  DB.transactions.push(row({ date:'2026-03-05', type:'RECEIPT', customerId:'CUS-1', credit:300, refNo:'RCT-1' }));
  DB.transactions.push(row({ date:'2026-03-06', type:'PAYMENT OUT', supplierId:'SUP-1', debit:200, refNo:'PAY-1' }));
  // And the same job taking money in a second currency, for the converted view.
  DB.transactions.push(row({ date:'2026-03-07', type:'RECEIPT', customerId:'CUS-1', credit:750,
                             currency:'SAR', accountId:'ACC-2', refNo:'RCT-SAR' }));
  // Part of the job, no part of its profit: a quotation. It must still be
  // listed, or "every transaction" means "the ones that happened to count".
  DB.transactions.push(row({ date:'2026-03-08', type:'QUOTATION', customerId:'CUS-1',
                             credit:5000, refNo:'QUO-1' }));
  save();
});

const onReport = async (pg, url, view) => {
  await pg.goto(url + '#/r_' + view);
  await pg.waitForTimeout(900);
};

module.exports = { name: 'reports the office asked for', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'reports2');
  await setup(pg);
  const { check } = ctx;

  /* ---- one record per number, in every list and every total ---- */
  await onReport(pg, ctx.appUrl, 'employee');
  await pg.selectOption('#curSel', 'USD'); await pg.waitForTimeout(600);

  const picker = await pg.evaluate(() =>
    [...document.querySelectorAll('#r_ent option')].map(o => o.textContent.trim()));
  check('a person held twice under one number appears once in the list',
        picker.filter(x => x === 'Wathiq Welder').length === 1, picker.join(' | '));

  const rows = await pg.evaluate(() => [...document.querySelectorAll('tbody tr')]
    .map(r => [...r.children].map(td => td.textContent.trim()))
    .filter(r => r[0] === 'Wathiq Welder'));
  check('and their pay is listed once, not twice', rows.length === 1,
        JSON.stringify(rows));
  check('so the report total counts that money once',
        rows.length === 1 && rows[0].join(' ').includes('100.00'), JSON.stringify(rows));

  const ticks = await pg.evaluate(() => selOptions('employee').map(o => o.label));
  check('the tick list holds one of each too',
        ticks.filter(x => x === 'Wathiq Welder').length === 1, ticks.join(' | '));

  /* ---- several people chosen: every payment, not just the summary ---- */
  await pg.evaluate(() => { rep.sel = { employee: ['EMP-1', 'EMP-2'] }; render(); });
  await pg.waitForTimeout(600);
  let heads = await pg.evaluate(() =>
    [...document.querySelectorAll('.card h2')].map(h => h.textContent.trim()));
  check('choosing several people opens every one of them',
        heads.filter(h => /every payment/.test(h)).length === 2, heads.join(' | '));
  const refs = await pg.evaluate(() => [...document.querySelectorAll('.card table tbody tr')]
    .map(r => [...r.children].map(c => c.textContent.trim()).join(' ')).join(' | '));
  check('and lists the payments behind each of them',
        refs.includes('M-1') && refs.includes('Y-1'), refs.slice(0, 300));

  await pg.evaluate(() => { rep.sel = {}; render(); });
  await pg.waitForTimeout(500);
  heads = await pg.evaluate(() =>
    [...document.querySelectorAll('.card h2')].map(h => h.textContent.trim()));
  check('choosing nobody does not open fifty-nine people',
        !heads.some(h => /every payment/.test(h)), heads.join(' | '));

  /* ---- reading every currency as one figure, from where the question is ---- */
  await pg.goto(ctx.appUrl + '#/data'); await pg.waitForTimeout(700);
  await pg.goto(ctx.appUrl + '#/ledger'); await pg.waitForTimeout(900);
  const ledgerOpts = await pg.evaluate(() =>
    [...document.querySelectorAll('#f_cur option')].map(o => o.value));
  check('the ledger offers the converted view among its currencies',
        ledgerOpts.includes('USD*'), ledgerOpts.join(','));

  await pg.selectOption('#f_cur', 'USD*');
  await pg.locator('button:has-text("Apply")').first().click();
  await pg.waitForTimeout(800);
  const afterLedger = await pg.evaluate(() => ({ cur: CUR, fx: FX_ON, top: $('#curSel').value }));
  check('choosing it there turns the whole system to it',
        afterLedger.cur === 'USD*' && afterLedger.fx === true && afterLedger.top === 'USD*',
        JSON.stringify(afterLedger));

  const repOpts = await pg.evaluate(() => selOptions('currency').map(o => o.v));
  check('the report currency list offers it too', repOpts.includes('USD*'), repOpts.join(','));
  check('and it narrows nothing, because it is a way of looking',
        await pg.evaluate(() => { rep.sel = { currency: ['USD*'] };
          const ok = selHas('currency', 'SAR') && selHas('currency', 'USD');
          rep.sel = {}; return ok; }));

  /* ---- the converted profit must not add riyals to dollars ---- */
  const converted = await pg.evaluate(() => {
    const prevC = CUR, prevF = FX_ON;
    CUR = 'USD*'; FX_ON = true;
    const l = txs({ projectId:'PRJ-A' });
    const out = { rev: round2(netRevenue(l)), cost: round2(netCost(l)) };
    CUR = prevC; FX_ON = prevF;
    return out;
  });
  // Revenue: 1,000 invoiced + 300 received against nothing + 750 SAR, which is
  // 200 USD at 3.75 — the figure that used to be added in riyals.
  check('a receipt in another currency is converted before it is counted',
        Math.abs(converted.rev - 1500) < 0.01, 'revenue ' + converted.rev);
  // Cost: the salary and two expenses (165) plus the 200 paid to a supplier
  // with no bill behind it.
  check('and a payment with no bill behind it is counted at its converted value',
        Math.abs(converted.cost - 365) < 0.01, 'cost ' + converted.cost);

  /* ---- profitability: the summary, and what is behind it ---- */
  await pg.evaluate(() => { setCurrency('USD'); rep = { from:'', to:'', entity:'', sel:{}, detail:'' }; });
  await onReport(pg, ctx.appUrl, 'project');
  let cards = await pg.evaluate(() =>
    [...document.querySelectorAll('.card h2')].map(h => h.textContent.trim()));
  check('the summary on its own is still the summary',
        !cards.some(h => /every transaction/.test(h)), cards.join(' | '));

  const hasSwitch = await pg.evaluate(() => !!document.querySelector('#r_detail'));
  check('profitability offers the second view', hasSwitch);

  await pg.selectOption('#r_detail', 'all');
  await pg.locator('button:has-text("Run")').first().click();
  await pg.waitForTimeout(900);
  cards = await pg.evaluate(() =>
    [...document.querySelectorAll('.card h2')].map(h => h.textContent.trim()));
  check('choosing it opens every transaction on the job',
        cards.some(h => /Go Green-14 — every transaction/.test(h)), cards.join(' | '));

  const detail = await pg.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find(c => /every transaction/.test((c.querySelector('h2') || {}).textContent || ''));
    if (!card) return null;
    const cell = r => [...r.children].map(td => td.textContent.trim());
    return { body: [...card.querySelectorAll('tbody tr')].map(cell),
             foot: [...card.querySelectorAll('tfoot tr')].map(cell) };
  });
  /* Six, not seven: the seventh is in riyals, and this is the dollar section.
     Reading it takes the converted view — which is the whole reason that view
     now sits on every list where a currency is chosen. */
  check('every entry on the job is listed, not only the ones that count',
        detail && detail.body.length === 7, detail && detail.body.length);
  check('and one that is no part of the profit says so, reading nothing',
        /QUO-1 Not part of profit\s*$/.test(
          (detail.body.find(r => r.join(' ').includes('QUO-1')) || []).slice(0, 7).join(' ') + ' ') ||
        (detail.body.find(r => r.join(' ').includes('QUO-1')) || []).slice(7, 9).join('') === '',
        JSON.stringify(detail.body.find(r => r.join(' ').includes('QUO-1'))));

  const seen = detail.body.map(r => r.join(' ')).join(' | ');
  check('a receipt no invoice accounts for is shown as revenue, and says why',
        /RCT-1 No document yet/.test(seen), seen);
  check('a payment no bill accounts for is shown as cost, and says why',
        /PAY-1 No document yet/.test(seen), seen);
  check('an invoice says it was invoiced', /INV-1 Invoiced/.test(seen), seen);

  const tally = await pg.evaluate(() => {
    const l = txs({ projectId:'PRJ-A' }).filter(selOk);
    let rev = 0, cost = 0;
    l.forEach(x => { const q = profitParts(x); rev += q.rev; cost += q.cost; });
    return { rowRev: round2(rev), rowCost: round2(cost),
             sumRev: round2(netRevenue(l)), sumCost: round2(netCost(l)) };
  });
  check('the entries add up to exactly the summary above them',
        tally.rowRev === tally.sumRev && tally.rowCost === tally.sumCost,
        JSON.stringify(tally));

  const shownRev = await pg.evaluate(v => fmt(v), tally.sumRev);
  check('and the foot of the detail says the same',
        detail.foot.length === 1 && detail.foot[0].join(' ').includes(shownRev),
        JSON.stringify(detail.foot) + ' expected ' + shownRev);

  /* The riyal entry must be reachable, and counted, once the converted view
     is on — otherwise "every transaction" quietly means "some of them". */
  await pg.evaluate(() => { setCurrency('USD*'); render(); });
  await pg.waitForTimeout(700);
  const convertedDetail = await pg.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find(c => /every transaction/.test((c.querySelector('h2') || {}).textContent || ''));
    return card ? [...card.querySelectorAll('tbody tr')]
      .map(r => [...r.children].map(td => td.textContent.trim()).join(' ')) : [];
  });
  check('the converted view lists the entry made in another currency too',
        convertedDetail.length === 8 && convertedDetail.join(' | ').includes('RCT-SAR'),
        convertedDetail.length + ' rows');
  check('and shows it converted, not at its face value',
        /RCT-SAR[^|]*200\.00/.test(convertedDetail.join(' | ')),
        convertedDetail.find(r => /RCT-SAR/.test(r)) || '(not found)');

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}};
