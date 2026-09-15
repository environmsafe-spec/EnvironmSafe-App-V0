'use strict';
/* The cloud account. The case that matters most is a weak connection: being
   offline must never sign anyone out of their own books. */
const { newDevice, toasts } = require('./helpers');

module.exports = { name: 'cloud account', run: async (ctx) => {
  const pg = await newDevice(ctx.browser, ctx.cloudUrl, 'auth');
  await pg.locator('a.navbtn[href="#/data"]').click();
  await pg.waitForTimeout(800);
  ctx.check('the Cloud account card is offered', await pg.locator('h2:has-text("Cloud account")').count() === 1);

  await pg.fill('#cl_email', ctx.account.email);
  await pg.fill('#cl_pw', 'not-the-password');
  await pg.locator('button:has-text("Sign in")').click(); await pg.waitForTimeout(800);
  ctx.check('a wrong password is explained', /not right/i.test(await toasts(pg)));
  ctx.check('a wrong password leaves you signed out', await pg.evaluate(() => cloudSignedIn()) === false);

  await pg.fill('#cl_pw', ctx.account.password);
  await pg.locator('button:has-text("Sign in")').click(); await pg.waitForTimeout(1200);
  ctx.check('the right password signs in', await pg.evaluate(() => cloudSignedIn()) === true);

  await pg.reload(); await pg.waitForTimeout(1100);
  ctx.check('the session survives a restart', await pg.evaluate(() => cloudSignedIn()) === true);

  await pg.evaluate(() => { CLOUD_SESSION.expires_at = Date.now() - 1000; cloudSave(CLOUD_SESSION); });
  const token = await pg.evaluate(() => cloudToken());
  ctx.check('an expired token is renewed', typeof token === 'string' && token !== 'AT-1', 'token=' + token);

  await pg.ctx.setOffline(true);
  await pg.evaluate(() => { CLOUD_SESSION.expires_at = Date.now() - 1000; cloudSave(CLOUD_SESSION); });
  ctx.check('offline yields no token', await pg.evaluate(() => cloudToken()) === null);
  ctx.check('offline does NOT sign you out', await pg.evaluate(() => cloudSignedIn()) === true);
  await pg.ctx.setOffline(false);

  await pg.goto(ctx.cloudUrl + '#/data'); await pg.waitForTimeout(1100);
  await pg.locator('button:has-text("Sign out of cloud")').click(); await pg.waitForTimeout(600);
  ctx.check('signing out clears the session', await pg.evaluate(() => cloudSignedIn()) === false);
  ctx.check('nothing is left in storage',
    await pg.evaluate(() => localStorage.getItem('environmsafe.cloud.session')) === null);

  await pg.fill('#cl_email', 'someone.else@environmsafe.com');
  await pg.fill('#cl_pw', 'Aden#2026');
  await pg.locator('button:has-text("Create account")').click(); await pg.waitForTimeout(900);
  ctx.check('a sign-up awaiting email confirmation is explained', /Confirm it from your email/i.test(await toasts(pg)));

  /* Every device that starts empty makes its own "admin", and syncing brings
     them together, so one name ends up on several records with different
     passwords. Signing in must be decided by the password, not by which record
     happens to sit first — otherwise people are locked out of their own books. */
  await pg.evaluate(async () => {
    const mine = DB.users[0];
    // Two more records of the same name, as other devices would have made them.
    for (const pw of ['OtherDevice#1', 'OtherDevice#2']) {
      const other = Object.assign({}, mine, { uid: newUid(), id: 'USR-XX-' + pw.slice(-1),
                                              mustChange: 'No' });
      await setPassword(other, pw);
      DB.users.unshift(other);
    }
    save();
  });
  const signInAs = async (name, pw) => {
    await pg.evaluate(() => { sessionStorage.clear(); loginScreen(); });
    await pg.waitForTimeout(300);
    await pg.fill('input[name="username"]', name);
    await pg.fill('input[name="password"]', pw);
    await pg.locator('form button:has-text("Sign in")').click();
    await pg.waitForTimeout(600);
    return pg.evaluate(() => !!USER && USER.id);
  };
  ctx.check('the password decides which record you are, not the order',
            await signInAs('admin', 'Aden#2026Test') !== false);
  ctx.check('another device\'s password of the same name also works',
            await signInAs('admin', 'OtherDevice#1') !== false);
  ctx.check('and a password belonging to none of them still fails',
            await signInAs('admin', 'NotAnyOfThem#9') === false);

  ctx.check('no uncaught errors', pg.errors.length === 0, pg.errors.slice(0,2).join(' | '));
  await pg.ctx.close();
}};
