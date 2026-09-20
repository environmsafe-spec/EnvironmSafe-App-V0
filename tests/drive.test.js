'use strict';
/* Copying the ledger to the company's own Google Drive. The free database plan
   takes no backups of its own, so this is the copy that survives anything
   happening to the database — and the way out if the company ever leaves.

   Google's sign-in window cannot be driven from a test, so a stand-in for
   `google.accounts.oauth2` is installed before the app loads. Everything after
   the token — folders, uploading, pruning, the daily schedule, refused
   credentials — runs against the stand-in Drive in mock-supabase.js. */
const { newDevice, addInvoice, toasts } = require('./helpers');

/* The app is told to talk to the stand-in instead of googleapis.com. */
const aimAtMock = (pg, base) => pg.evaluate(b => {
  DRIVE_API = { files: b + '/drive/v3/files', upload: b + '/upload/drive/v3/files' };
}, base);

const setUp = (pg, id) => pg.evaluate(i => {
  DB.meta.driveClientId = i; save();
  // Stand in for Google's library: grants a token without a window.
  window.google = { accounts: { oauth2: { initTokenClient: cfg => ({
    requestAccessToken: () => cfg.callback({ access_token: 'DRIVE-TOKEN', expires_in: 3600 })
  }) } } };
}, id);

module.exports = { name: 'drive backup', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.cloudUrl, 'drive');
  await pg.locator('a.navbtn[href="#/data"]').click();
  await pg.waitForTimeout(700);

  ctx.check('the Drive card is offered', await pg.locator('h2:has-text("Copy to Google Drive")').count() === 1);
  ctx.check('it asks for the client id before doing anything',
    await pg.locator('#dr_id').count() === 1);
  ctx.check('with nothing set up a quiet backup does nothing, quietly',
    await pg.evaluate(() => driveBackup(true)) === null);

  await aimAtMock(pg, ctx.mockBase);
  await setUp(pg, 'test.apps.googleusercontent.com');
  await addInvoice(pg, 'INV-DRIVE');

  const first = await pg.evaluate(() => driveBackup(true));
  ctx.check('the ledger is written to Drive', !!first && /^environmsafe-.*\.json$/.test(first.name),
            first ? first.name : 'no file');
  const stored = ctx.mock.driveFiles;
  ctx.check('a folder was made for the copies',
    [...stored.values()].some(f => f.mimeType === 'application/vnd.google-apps.folder'
                                && f.name === 'EnvironmSafe Backups'));
  const uploaded = [...stored.values()].filter(f => f.mimeType === 'application/json');
  ctx.check('the copy holds the whole ledger', uploaded.length === 1 && uploaded[0].size > 500,
            uploaded.length ? uploaded[0].size + ' bytes' : 'nothing uploaded');

  const folders = () => [...ctx.mock.driveFiles.values()]
    .filter(f => f.mimeType === 'application/vnd.google-apps.folder').length;
  await pg.evaluate(() => driveBackup(true));
  ctx.check('the folder is made once, not on every copy', folders() === 1, folders() + ' folders');

  /* A copy a day: due only when a day has passed. */
  const before = ctx.mock.driveFiles.size;
  await pg.evaluate(() => driveMaybeBackup());
  await pg.waitForTimeout(400);
  ctx.check('a second copy is not taken the same day', ctx.mock.driveFiles.size === before);
  await pg.evaluate(() => { DRIVE.lastAt = new Date(Date.now() - 25*60*60*1000).toISOString(); driveSave(); });
  await pg.evaluate(() => driveMaybeBackup());
  await pg.waitForTimeout(600);
  ctx.check('a copy is taken once a day has passed', ctx.mock.driveFiles.size > before);

  /* Old copies are cleared so the folder cannot grow for ever. */
  await pg.evaluate(async () => {
    for (let i = 0; i < 16; i++) {
      DRIVE.lastAt = ''; await driveBackup(true);
    }
  });
  const kept = [...ctx.mock.driveFiles.values()].filter(f => f.mimeType === 'application/json').length;
  ctx.check('only the recent copies are kept', kept <= 14, kept + ' copies kept');

  /* Credentials Google refuses must be dropped, so the next attempt asks again. */
  await pg.evaluate(() => { DRIVE.lastAt = ''; driveSave(); });
  ctx.mock.driveFails = 401;
  const refused = await pg.evaluate(() => driveBackup(true));
  ctx.check('a refused token is discarded', refused === null
    && await pg.evaluate(() => DRIVE.token) === '');

  /* Being offline must never look like a failure of the books. */
  await pg.ctx.setOffline(true);
  await pg.evaluate(() => { DRIVE.token = 'DRIVE-TOKEN'; DRIVE.expiresAt = Date.now() + 3600000;
                            DRIVE.lastAt = ''; driveSave(); });
  const off = await pg.evaluate(() => driveBackup(false));
  ctx.check('offline fails gently', off === null);
  ctx.check('and says so in plain words', /connection|later/i.test(await toasts(pg)), await toasts(pg));
  await pg.ctx.setOffline(false);

  /* The daily copy must never take over the screen. The Google client id
     travels with the books, so a device opened at a new web address inherits it
     without Google having been told that address is allowed — and Google
     answers there with a full-page refusal of its own, in the middle of an
     ordinary sync. */
  const autoTried = () => pg.evaluate(() => {
    const before = window.__driveAsked || 0;
    DRIVE.lastAt = "2020-01-01T00:00:00Z"; driveSave();
    driveMaybeBackup();
    return (window.__driveAsked || 0) > before;
  });
  await pg.evaluate(() => {
    window.__driveAsked = 0;
    const real = driveToken;
    window.driveToken = (...a) => { window.__driveAsked++; return real(...a); };
  });
  await pg.evaluate(() => { DRIVE.origin = "https://somewhere-else.example"; driveSave(); });
  ctx.check('the daily copy is not attempted at an address Google has not allowed',
            await autoTried() === false);
  await pg.evaluate(() => { DRIVE.origin = location.origin; driveSave(); });
  ctx.check('and is attempted where Google has already let us in',
            await autoTried() === true);

  /* The wrong kind of client is the one failure Google explains worst. It
     answers "Access blocked: Authorization Error" and nothing else, and the
     field everyone is told to fix does not exist on a Desktop client. The
     screen has to say so, and the id has to be changeable without turning the
     whole backup off first. */
  // The card on screen was drawn before the client id existed; ask for a fresh one.
  await pg.evaluate(() => render());
  await pg.waitForTimeout(500);
  const standing = await pg.evaluate(() => {
    const card = [...document.querySelectorAll('.card')]
      .find(c => /Copy to Google Drive/.test((c.querySelector('h2') || {}).textContent || ''));
    return card ? card.textContent.replace(/\s+/g, ' ') : '';
  });
  ctx.check('the card names the kind of client Google needs',
            /Web application/.test(standing) && /Desktop/.test(standing), standing.slice(0, 200));
  ctx.check('and the address to allow, exactly as Google wants it',
            standing.includes(await pg.evaluate(() => location.origin)), standing.slice(0, 200));

  const hasEdit = await pg.locator('button:has-text("Change the client id")').count();
  ctx.check('the client id can be changed without stopping the backup', hasEdit === 1);

  await pg.locator('button:has-text("Change the client id")').click();
  await pg.waitForTimeout(400);
  const form = await pg.evaluate(() => {
    const i = document.querySelector('#dr_id');
    const card = [...document.querySelectorAll('.card')]
      .find(c => /Copy to Google Drive/.test((c.querySelector('h2') || {}).textContent || ''));
    return { filled: i ? i.value : null, says: card ? card.textContent.replace(/\s+/g,' ') : '' };
  });
  ctx.check('it opens on the id already in use, not blank',
            form.filled === 'test.apps.googleusercontent.com', String(form.filled));
  ctx.check('and repeats what kind of client it has to be',
            /must be .Web application./.test(form.says), form.says.slice(0, 260));

  /* A grant belongs to the client it was issued to. Asking Google again under
     the new one is the only way to know the new one works — carrying the old
     token over would look like success and fail on the next real call. */
  await pg.evaluate(() => {
    window.__grants = 0;
    window.google = { accounts: { oauth2: { initTokenClient: cfg => ({
      requestAccessToken: () => { window.__grants++;
        cfg.callback({ access_token: 'GRANTED-AGAIN', expires_in: 3600 }); }
    }) } } };
  });
  await pg.evaluate(() => { document.querySelector('#dr_id').value = 'client-999.apps.googleusercontent.com'; });
  await pg.locator('button:has-text("Save and connect")').click();
  await pg.waitForTimeout(900);
  const swapped = await pg.evaluate(() => ({ id: driveClientId(), token: DRIVE.token,
                                             grants: window.__grants }));
  ctx.check('saving a different id takes effect',
            swapped.id === 'client-999.apps.googleusercontent.com', swapped.id);
  ctx.check('and the grant held for the old client is not carried over',
            swapped.grants === 1 && swapped.token === 'GRANTED-AGAIN', JSON.stringify(swapped));

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
