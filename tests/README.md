# Tests

Every suite drives a real browser against the real `web/app/index.html`. There is
no build step and nothing is stubbed inside the app: the file under test is the
file that ships.

```bash
npm install          # once — fetches Playwright
npm test             # everything
npm test -- sync     # only suites whose name contains "sync"
```

## What each suite protects

| Suite | Guards against |
|---|---|
| `app` | A statement that will not render, an Excel export that writes nothing, a print button that does nothing, the duplicate guard falling silent, sidebar entries ceasing to be links (which is what allows a second tab) |
| `identity` | Two devices claiming the same record. The dangerous case is two *different* records sharing one number — records written before device tags, or two devices drawing the same tag — where matching by number silently destroys one invoice |
| `print` | Columns falling off the printed page. A wide table scrolls on screen; paper cannot scroll, and the ledger once printed without Debit and Credit. Widths are measured at A4 |
| `cloud account` | Being signed out by a weak connection, an expired token not renewing, a session not surviving a restart, failures shown as HTTP codes instead of sentences |
| `sync` | The point of the whole thing: a replacement phone signing in and recovering the ledger. Also deletions returning from the dead, and work done offline being lost |
| `drive backup` | The copy the company owns outright going stale or absent: a folder made afresh every day, old copies never cleared, a token Google has refused being reused, and being offline looking like a failure of the books |

## The stand-in server

`mock-supabase.js` implements exactly the requests the app makes — sign-in, token
refresh, sign-up, membership, and `es_records`. It is not an emulator. It exists so
the suite runs anywhere, offline, and can stage what a real server will not stage on
demand: an expired token, a refused refresh, a sign-up awaiting email confirmation.

Because it is a stand-in, it cannot prove the app works against the real Supabase —
only that the app's side of the conversation is unchanged. If a request shape
changes, these tests fail loudly, which is the point.

## Adding a test

A suite exports `{ name, run }` and calls `ctx.check(description, condition, detail)`.
`ctx` carries `browser`, `appUrl`, `cloudUrl` (the same app pointed at the stand-in
server) and `account`. Register it in `run.js`.

Write the description as the promise being kept — "a replacement phone recovers the
whole ledger", not "test sync 4".

**Check a new test can fail.** Break the code it covers and confirm it goes red. A
test that passes either way protects nothing: the identity suite once passed with
merging reverted to matching on the number, because the case it used no longer
collided.
