'use strict';
/* Correcting a few records on a system people are already using.

   The dangerous thing here is not failing to apply a correction — it is
   applying more than the correction. Once someone has been entering and editing
   transactions, a file that quietly resets an amount, a date, or an edit they
   made by hand does far more damage than the mistake it fixes. So most of what
   follows checks what did NOT change. */

const { newDevice } = require('./helpers');

const seed = pg => pg.evaluate(() => {
  DB.projects.push({ id: 'PRJ-OLD', uid: 'p-old', nameEn: 'Go Green-006-Radiators', status: 'active' });
  const base = {
    phase: 'OTHER', caseNo: '', customerId: '', supplierId: '', employeeId: '',
    projectId: 'PRJ-OLD', accountId: '', categoryId: '', itemId: '', qty: 0,
    unitPrice: 0, discount: 0, isAsset: 'No', currency: 'USD', fxRate: 1,
    status: 'Approved', againstRef: '', docType: '', docRef: '' };
  DB.transactions.push(Object.assign({}, base, { id: 'TRX-A', uid: 'u-a',
    sourceRef: 'TRX-000399', date: '2026-05-01', type: 'EXPENSE', debit: 700, credit: 0,
    refNo: 'V-1', notes: 'edited here by hand', updatedAt: '2026-05-01T00:00:00.000Z' }));
  DB.transactions.push(Object.assign({}, base, { id: 'TRX-B', uid: 'u-b',
    sourceRef: 'TRX-000400', date: '2026-05-02', type: 'INVOICE OUT', debit: 0, credit: 1250,
    refNo: 'V-2', notes: '', updatedAt: '2026-05-02T00:00:00.000Z' }));
  // a record entered on this device, named by nothing in the file
  DB.transactions.push(Object.assign({}, base, { id: 'TRX-MINE', uid: 'u-mine',
    sourceRef: '', date: '2026-05-03', type: 'EXPENSE', debit: 99, credit: 0,
    refNo: 'MINE', notes: 'typed in on the phone', updatedAt: '2026-05-03T00:00:00.000Z' }));
  save();
});

const snapshot = pg => pg.evaluate(() => DB.transactions.map(x => ({
  id: x.id, date: x.date, type: x.type, debit: x.debit, credit: x.credit,
  refNo: x.refNo, notes: x.notes, customerId: x.customerId, status: x.status,
  project: (byId('projects', x.projectId) || {}).nameEn || '' })));

async function run(ctx) {
  const { check } = ctx;
  const pg = await newDevice(ctx.browser, ctx.appUrl, 'patch');
  await seed(pg);
  const before = await snapshot(pg);

  const patch = { kind: 'environmsafe-corrections', version: 1, fields: ['projectId'], rows: [
    { sourceRef: 'TRX-000399', was: 'Go Green-006-Radiators', project: 'Monthly Salary- Yasmeen' },
    { sourceRef: 'TRX-000400', was: 'Go Green-006-Radiators', project: 'Go Green-15-Filters RACOR' },
    { sourceRef: 'TRX-999999', was: 'whatever', project: 'Nowhere-001' }   // not on this device
  ]};

  const plan = await pg.evaluate(p => {
    const r = planCorrections(p);
    return { change: r.change.length, already: r.already.length, missing: r.missing,
             newProjects: [...r.newProjects] };
  }, patch);
  check('the plan counts what will change before anything changes',
        plan.change === 2 && plan.missing.length === 1 && plan.missing[0] === 'TRX-999999',
        JSON.stringify(plan));
  check('it says which projects it would have to create',
        plan.newProjects.length === 2, JSON.stringify(plan.newProjects));
  check('planning alone changes nothing',
        JSON.stringify(await snapshot(pg)) === JSON.stringify(before));

  const done = await pg.evaluate(p => {
    const r = applyCorrections(p);
    return { changed: r.change.length, missing: r.missing.length };
  }, patch);
  check('it corrects the records the file names', done.changed === 2 && done.missing === 1,
        JSON.stringify(done));

  const after = await snapshot(pg);
  const byId_ = (list, id) => list.find(x => x.id === id);
  check('the first record moved to its right project',
        byId_(after, 'TRX-A').project === 'Monthly Salary- Yasmeen', byId_(after, 'TRX-A').project);
  check('the second did too',
        byId_(after, 'TRX-B').project === 'Go Green-15-Filters RACOR', byId_(after, 'TRX-B').project);

  // everything else about those two records must be untouched
  const same = (a, b) => ['date','type','debit','credit','refNo','notes','customerId','status']
    .every(k => a[k] === b[k]);
  check('nothing else on a corrected record moved — not the money, not a hand edit',
        same(byId_(before, 'TRX-A'), byId_(after, 'TRX-A')) &&
        same(byId_(before, 'TRX-B'), byId_(after, 'TRX-B')));
  check("a record the file does not name is not touched at all",
        JSON.stringify(byId_(before, 'TRX-MINE')) === JSON.stringify(byId_(after, 'TRX-MINE')));
  check('no record is created or removed', before.length === after.length,
        `${before.length} → ${after.length}`);

  // only the corrected rows are re-stamped, so only they travel to other devices
  const stamps = await pg.evaluate(() => Object.fromEntries(
    DB.transactions.map(x => [x.id, x.updatedAt])));
  check('only the corrected records are marked for sync',
        stamps['TRX-MINE'] === '2026-05-03T00:00:00.000Z' &&
        stamps['TRX-A'] > '2026-05-01T00:00:00.000Z' &&
        stamps['TRX-B'] > '2026-05-02T00:00:00.000Z', JSON.stringify(stamps));

  // running it twice must be a no-op, not a second set of projects
  const twice = await pg.evaluate(p => {
    const projectsBefore = DB.projects.length;
    const r = applyCorrections(p);
    return { changed: r.change.length, grew: DB.projects.length - projectsBefore };
  }, patch);
  check('applying the same file again does nothing',
        twice.changed === 0 && twice.grew === 0, JSON.stringify(twice));

  /* ---- several records moving to the SAME new project ---- */
  // The real correction file sends five transactions to UNHCR-GEN-001. If each
  // row made its own project, the list would fill with five identical entries
  // and every report that groups by project would split them apart.
  await pg.evaluate(() => {
    ['TRX-000407', 'TRX-000408', 'TRX-000410'].forEach((ref, i) => {
      DB.transactions.push({ id: 'TRX-U' + i, uid: 'u-u' + i, sourceRef: ref,
        date: '2026-06-0' + (i + 1), type: 'EXPENSE', debit: 100, credit: 0,
        projectId: 'PRJ-OLD', currency: 'USD', fxRate: 1, status: 'Approved',
        customerId: '', supplierId: '', employeeId: '', accountId: '',
        updatedAt: '2026-06-01T00:00:00.000Z' });
    });
    save();
  });
  const shared = await pg.evaluate(() => {
    const projectsBefore = DB.projects.length;
    const r = applyCorrections({ kind: 'environmsafe-corrections', rows: [
      { sourceRef: 'TRX-000407', project: 'UNHCR-GEN-001' },
      { sourceRef: 'TRX-000408', project: 'UNHCR-GEN-001' },
      { sourceRef: 'TRX-000410', project: 'UNHCR-GEN-001' }
    ]});
    const named = rowsOf('projects').filter(p => p.nameEn === 'UNHCR-GEN-001');
    return { changed: r.change.length, made: DB.projects.length - projectsBefore,
             named: named.length,
             allSame: new Set(['TRX-U0','TRX-U1','TRX-U2']
               .map(id => DB.transactions.find(x => x.id === id).projectId)).size };
  });
  check('three records moving to one new project make one project, not three',
        shared.changed === 3 && shared.made === 1 && shared.named === 1,
        JSON.stringify(shared));
  check('and all three end up on the very same project record',
        shared.allSame === 1, JSON.stringify(shared));

  check('no page errors', pg.errors.length === 0, pg.errors.join(' | '));
  await pg.ctx.close();
}

module.exports = { name: 'correcting a live system', run };
