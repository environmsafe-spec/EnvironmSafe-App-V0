#!/usr/bin/env node
'use strict';
/* Runs every suite against the real web/app/index.html in a real browser.
   Usage:  npm test            all suites
           npm test -- sync    only suites whose name contains "sync" */

const fs = require('fs');
const { playwright, buildFixtures, startStatic } = require('./helpers');
const { startMockSupabase } = require('./mock-supabase');

const STATIC_PORT = Number(process.env.ES_TEST_PORT || 8921);
const MOCK_PORT   = Number(process.env.ES_MOCK_PORT || 8922);
const ACCOUNT     = { email: 'akram@environmsafe.com', password: 'Aden#2026' };

const SUITES = ['./app.test', './identity.test', './print.test', './auth.test', './sync.test', './drive.test']
  .map(m => require(m));

(async () => {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const mockUrl = `http://127.0.0.1:${MOCK_PORT}`;
  const dir = buildFixtures(mockUrl);

  const mock   = await startMockSupabase(MOCK_PORT, ACCOUNT);
  const static_ = await startStatic(dir, STATIC_PORT);
  const { chromium } = playwright();
  // The sandbox routes outbound traffic through a proxy that would swallow
  // requests to 127.0.0.1, so the browser is told to go direct.
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });

  let pass = 0, fail = 0;
  const failures = [];

  let ran = 0;
  for (const suite of SUITES) {
    if (only.length && !only.some(o => suite.name.includes(o))) continue;
    ran++;
    console.log(`\n── ${suite.name} ──`);
    const ctx = {
      browser,
      appUrl:   `http://127.0.0.1:${STATIC_PORT}/app.html`,
      cloudUrl: `http://127.0.0.1:${STATIC_PORT}/app-cloud.html`,
      account:  ACCOUNT,
      mock,
      mockBase: mockUrl,
      check(name, ok, extra) {
        ok ? pass++ : fail++;
        if (!ok) failures.push(`${suite.name}: ${name}${extra ? '  (' + extra + ')' : ''}`);
        console.log(`  ${ok ? 'PASS' : 'FAIL'} · ${name}${extra ? '  ' + extra : ''}`);
      }
    };
    try { await suite.run(ctx); }
    catch (e) { fail++; failures.push(`${suite.name}: threw — ${e.message}`);
                console.log(`  FAIL · suite threw: ${e.message}`); }
  }

  await browser.close();
  static_.close(); mock.close();
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); }

  // A run that checked nothing must never report success: an empty suite list, a
  // filter matching no suite, or a suite that quietly stopped registering checks
  // would otherwise show green and prove nothing.
  if (!ran) {
    console.error(only.length ? `\nNo suite matched: ${only.join(', ')}` : '\nNo suites are registered.');
    process.exit(1);
  }
  if (pass + fail === 0) { console.error('\nNo checks ran.'); process.exit(1); }

  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('test runner failed:', e); process.exit(1); });
