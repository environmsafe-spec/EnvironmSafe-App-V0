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

### Products & services

**Master data → Products & services** holds everything the company quotes, buys or
sells: code, English and Arabic description, type (Goods / Service / Work), unit,
selling price and purchase price. Choose an item on a daily entry line and the
unit price fills itself — selling price on anything going out to a customer,
purchase price on anything coming in from a supplier — then quantity × unit price
fills the amount.

A document with several items is several lines sharing one reference number. That
keeps one row per event, and it is what lets the system report per product.

### Fixed assets

**Master data → Fixed assets** is the register: tag, name in both languages,
category, serial or plate number, location, custodian, supplier, acquisition date
and cost, useful life, residual value, status and source. Assets the company
already owns go in directly with source *Opening balance*.

New assets arrive through the purchase itself. Tick **"Is this a fixed asset?"**
on a supplier bill, expense or payment out — it ticks itself when the catalogue
item is marked as an asset — give the tag and location, and saving the purchase
writes the register entry, linked back to the transaction that bought it.

**Reports → Asset register & depreciation** shows acquisition cost, depreciation
for the period, accumulated depreciation and net book value, per asset and by
category, over any date range.

Depreciation is straight line: `(cost − residual) ÷ useful life`, charged monthly
from the acquisition date and stopping at disposal. An asset with no useful life
is held at cost.

**Buying an asset is not a cost of the period.** It is capital spending: it does
not reduce profit, depreciation does, spread across the asset's life. The money
still leaves the bank and the supplier is still owed exactly as before — only the
profit treatment differs. The financial summary shows capital spending and
depreciation on separate lines so both are visible.

### Currencies

Accounts hold USD, SAR, YER or AED and **money is never added across
currencies**. Every transaction records the currency of the account it moved
through. The picker in the top bar chooses which currency you are looking at;
"All currencies" shows one dashboard block per currency rather than one wrong
total. Bank balances, customer and supplier balances, revenue, costs and profit
are all reported inside a single currency.

### Importing an existing workbook

`tools/import_workbook.py` converts an Excel workbook into a backup file the app
merges:

```
pip install openpyxl
python3 tools/import_workbook.py <workbook.xlsx> -o environmsafe-import.json
```

Then in the app: **Backup & sync → Merge a backup**. It derives customers,
suppliers, employees, projects and accounts from the text used in the
transactions (merging names that differ only by case), reads the currency from
the account name, maps the sheet's money-out/money-in direction onto transaction
types, and skips empty template rows and spreadsheet total rows. Imported records
are numbered from 1001 so they can never collide with records already on the
device.

### Official documents

**Reports → Official documents** turns the lines sharing a reference number into a
printable document on company letterhead: logo, legal name in English and Arabic,
activity, address, contacts, tax and registration numbers, then the customer's
details, the numbered item lines with units and prices, totals, the bank account
for payment, and signature blocks for prepared / approved / received. Quotation,
invoice, purchase order and voucher titles follow the transaction type.

Edit the letterhead under **System → Company profile** — every report and document
picks it up, and the logo can be replaced there too.

### Reports

Financial summary · Customer statement · Supplier statement · Project
profitability · Employee report · Bank & cash ledger · Product & service report
(quantity sold and bought, sales and purchase value, average price and margin per
item, with the movement detail behind any one item). Each takes a date range,
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

### 2. The letterhead

The company logo ships inside the app and appears in the top bar, on the sign-in
screen and at the head of every report and document. Under **System → Company
profile** an Administrator fills in the legal name in both languages, activity
line, address, phones, email, website, tax and commercial registration numbers,
and the default currency — and can replace the logo with any image under 400 KB.
The preview on that screen shows exactly what will print.

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
items       ITM-0000  code nameEn nameAr kind unit category salePrice costPrice
                      isAsset lifeYears notes
assets      AST-0000  tag nameEn nameAr category itemId serial location custodianId
                      supplierId acquiredOn qty cost lifeYears salvage method status
                      source sourceTx disposedOn disposalValue notes
transactions TRX-000000
            date type phase caseNo customerId supplierId employeeId projectId
            accountId categoryId itemId qty unitPrice isAsset debit credit status refNo
            docType docRef notes
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
