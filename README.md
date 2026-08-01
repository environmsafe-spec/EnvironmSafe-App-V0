# EnvironmSafe — Procurement & Financial Management System

EnvironmSafe for Engineering, Trading, and Services Ltd. · Aden ·
[environmsafe.com](https://www.environmsafe.com) · support@environmsafe.com · 783402932

One system, two ways to reach it:

- **Android app** — install the APK from the
  [latest release](https://github.com/environmsafe-spec/EnvironmSafe-App-V0/releases/latest).
- **Website** — open `web/index.html` (landing page) or `web/app/` (the system itself)
  in any browser.

Both run the *same* files: `web/app/index.html` is copied into the APK at build
time, so a change to the system reaches the phone and the website together.

---

## How the system is organised

### One entry screen

Every business event is one row on **Daily entry**, exactly as an accounting
package works. The row carries:

| Field | Purpose |
|---|---|
| Date, Transaction type, Phase | what happened, and where it sits in the procurement flow |
| Case / file no | ties every document of one deal together (`CASE-2026-001`) |
| Customer / Supplier / Employee / Project | who it belongs to |
| Bank / cash account | which account the money moved through |
| Amount → Debit or Credit | posted automatically by transaction type |
| Status | Draft → Approved → Paid → Closed |
| Reference no, Document type, Document file/link | the paperwork |

### Procurement phases

`RFQ IN → RFQ OUT → QUOTATION IN → QUOTATION OUT → PO IN → PO OUT →
INVOICE IN → INVOICE OUT → PAYMENT → OTHER`

You can start at any phase. **Procurement files** groups every row sharing a case
number and shows which phases are complete, plus the revenue, cost and margin of
that deal.

### Posting rules

Amounts land in the Debit or Credit column by transaction type:

| Transaction | Column | Effect on reports |
|---|---|---|
| Customer invoice (INVOICE OUT) | Credit | revenue, receivable ↑ |
| Receipt from customer | Credit | cash ↑, receivable ↓ |
| Supplier bill (INVOICE IN) | Debit | cost, payable ↑ |
| Payment to supplier | Debit | cash ↓, payable ↓ |
| Expense, Salary, Advance | Debit | cost and/or cash ↓ |
| Loan in / Loan out | Credit / Debit | cash ↑ / ↓ |

`Balance = Total Debit − Total Credit` is reported as specified. Because invoices
and receipts both post to Credit under that rule, the reports read each row by its
**type** as well — revenue counts invoices only, cash counts receipts only — so
revenue is never inflated by collecting an invoice.

### Reports

Financial summary · Customer statement · Supplier statement · Project
profitability · Employee report · Bank & cash ledger. Each takes a date range,
shows opening / period / closing balances with a running balance, and prints to
PDF with the company header (browser → Print → Save as PDF).

### Users and roles

The system is locked behind a username and password, and each person gets their
own account with a role. See *Sign in* below for the first-use credentials.

---

## Setting it up for daily use

### 1. Sign in

The system opens on a sign-in screen. On a brand-new device one account exists:

| Username | Password | Role |
|---|---|---|
| `admin` | `EnvironmSafe@2026` | Administrator |

**Change it on first sign-in** — the system forces this before letting you in.
Then create an account per person under **Users**: give each a username, a role,
and a starting password they will be asked to replace when they first sign in.

| Role | Can do |
|---|---|
| Administrator | everything, including managing users |
| Data Entry | create and edit transactions and master data |
| Reviewer | the same, plus approving transactions |
| Manager | read-only — dashboards and reports |

Sign-in keeps other people out of the app on a shared phone. It does **not**
encrypt the stored data, so a backup file is readable by anyone who has it —
keep backups somewhere private. Passwords are stored as salted SHA-256 hashes,
never in plain text.

### 2. The logo

The company logo is already embedded in the app, the sign-in screen and every
printed report. To replace it, set `COMPANY.logo` near the top of the script in
`web/app/index.html` to a new data URI.

### 3. Load your customers and suppliers from Excel

In Excel: **File → Save As → CSV**. Then in the app: **Customers → Import CSV**
(same for Suppliers). Column headers are matched automatically for name, phone,
email, address and contact person; anything unmatched is ignored. Import as many
times as you like — nothing is overwritten.

### 4. Check the master data

Bank and cash accounts are pre-loaded with Tadhamon, Al Quataibi, Al Kuraimi,
office cash and a Visa card, and expense categories with marketing, operations,
salaries, motivation, shipping, government fees and bank charges. Edit them, set
opening balances, then start entering.

---

## Working with 5 users

Each device holds its own database and works fully offline. To combine work:

1. **Backup & sync → Download backup file** on one device.
2. Send the file to the next person (WhatsApp, Drive, email, cable).
3. On their device: **Backup & sync → Merge a backup**.

Merging keeps every record from both sides and, when the same record was edited
in both places, keeps the newer version. Nothing is lost and merging twice is
harmless.

**This is file-based sync, not live sync.** Two people entering at the same time
stay separate until someone merges. Continuous multi-user sync needs a server
database — see below.

---

## Next step: live synchronisation

To make the 5 users share data continuously, the system needs a hosted database
(Supabase/Postgres is the natural fit — the tables below map to it directly).
That requires an account, a monthly cost and login accounts per user, so it is
deliberately not switched on. The current storage layer is deliberately narrow —
`load`, `save` and `mergeDb` — so moving to a server does not disturb the screens.

### Data model

```
users       USR-0000  nameEn nameAr username role active phone notes (+ salted hash)
customers   CUS-0000  nameEn nameAr contact phone email address opening notes
suppliers   SUP-0000  nameEn nameAr contact phone email address opening notes
employees   EMP-0000  nameEn nameAr position phone salary notes
projects    PRJ-0000  nameEn nameAr customerId kind status budget notes
accounts    ACC-0000  nameEn nameAr kind bank number currency opening notes
categories  CAT-0000  nameEn nameAr kind notes
transactions TRX-000000
            date type phase caseNo customerId supplierId employeeId projectId
            accountId categoryId debit credit status refNo docType docRef notes
            createdBy createdAt updatedAt
```

Documents are referenced by name or link today; file upload belongs with the
server step, where the files have somewhere to live.

---

## Building the APK

`.github/workflows/android.yml` builds on GitHub's runners and publishes one
release per `versionName` in `app/build.gradle`. Push to `main` and the release
assets are replaced; raise `versionName` for a new release.

| File | Installable |
|---|---|
| `EnvironmSafe-v0-debug.apk` | yes — this is the one to install |
| `EnvironmSafe-v0-release-unsigned.apk` | no — sign it with a release keystore first |

Local build: `gradle assembleDebug` with JDK 17 and the Android SDK
(platform 34, build-tools 34.0.0).
