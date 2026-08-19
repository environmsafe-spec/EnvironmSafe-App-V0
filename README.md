# EnvironmSafe — Procurement & Finance

The app is one self-contained file: `web/index.html` (HTML, CSS and JavaScript inline,
no build step, no dependencies). It runs offline and stores its data in the browser's
local storage on the device that entered it — bilingual (English / Arabic).

## Running it
- Open `web/index.html` in any browser, or
- host the `web` folder on any static host (Netlify config is in `netlify.toml`).

## Android
`app/` is the Android wrapper project, built by Codemagic (`codemagic.yaml`).

## Privacy
No bank account numbers, passwords or customer data belong in this repository.
Bank details are entered once under **System → Company profile** inside the app and
are stored with the user's own data, never in the code.

## Tests
`node test_dup_transactions.js` — the duplicate guard on the daily transaction entry.
