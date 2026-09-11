# Turning the workbook into books the app can read

`convert.py` reads the EnvironmSafe finance workbook and writes
`environmsafe-import.json`, which System → Data → **Replace the books** loads
into the app. `validate.js` then re-implements the app's own posting rules over
that file and prints what the books will say once it is loaded — read it before
loading anything.

```
python3 convert.py /path/to/workbook.xlsx     # writes environmsafe-import.json
node    validate.js                           # prints the books it will produce
```

Neither file is committed: they are the company's real financial records and
this repository is public.

## What the converter decides, and why

**Only rows carrying money are transactions.** The workbook is a 15,000-row
template; all but a few hundred rows are empty scaffolding. A row is taken only
when it has a debit or a credit.

**Summary rows are not transactions.** A line sitting on the pseudo-account
`Total`, or carrying a debit *and* a credit with no account at all, is the
sheet's own subtotal. Loading one would invent an expense that never happened.

**Currency comes from the account label.** `USD-Kur` is a dollar account at Al
Kuraimi, `YER-QUT` a rial account at Al Quataibi. Every row inherits the
currency of the account the money moved through, and money is never added
across currencies.

**Every row gets an exchange rate.** The workbook has no rate column, so each
row is stamped with the standing rate for its currency. A row whose real rate
differed is corrected in the app afterwards, and that row's own rate then wins
over the standing one.

**The company is not a customer.** `EnvironmSafe` in the Customer column means
*this money was ours*: a salary, an expense, an owner drawing. The bogus
customer link is dropped and the row keeps the supplier or employee it names —
which is who the money actually went to.

**Money moving between our own accounts is a movement, not business.** Rows
labelled `Internal Transfer`, `INTRENAL TRANSFER` (both spellings, one thing) or
`PEDDY CASH` are posted as `TRANSFER OUT` on the account that lost the money and
`TRANSFER IN` on the account that gained it, with no customer and no supplier.
They are neither revenue nor cost — they exist so each account's balance is
right and the history shows where the money went. The two legs are linked to
each other through *Against document*, so either ledger leads to the other.
Legs the workbook describes too differently to match are still loaded, marked in
their notes, and listed as flags at the end of the run.

**Petty cash is an account.** `SAR-YAS-PEDDY`, `USD-YAS-PEDDY` and `YER-YAS-PED`
are cash accounts like any other: money is transferred in, spent out, and
whatever remains is the box's balance, visible on the bank & cash report next to
the banks.

**A DEBIT is a drawing for the owners and a loan for everyone else.** Money
handed to Akram or Hayel is theirs to take: `OWNER DRAWINGS`. Money handed to any
other employee is money the company expects back, so it is recorded as
`ADVANCE TO EMPLOYEE` — it moves cash but is not a cost, and it stays visible on
that employee's report until it is returned. A DEBIT naming nobody is not a
drawing by anyone; in this workbook it is a card charge that was reversed, and it
is treated as the movement its matching leg says it is.

**The books start on 19 July 2025.** Payments received before that date are in
the workbook; the invoices they settled are not. Left alone, each one reads as a
customer paying for nothing and the statement opens deep in credit — which
understates what they still owe. One entry per customer per currency, dated
18 July 2025 and referenced `OPEN-2025-07-19`, stands in for the missing
invoices and brings every customer to exactly zero at the cutoff. It carries no
bank account, so it moves no money — only the balance. Change `OPEN_CUTOFF` to
move the date.

**One spelling per party.** `Al Zailee` and `Al  Zailee` are the same customer
and merge. `AL ZAILEE-ADEN` is a different customer and keeps its own record.

## The house rule it checks

A project belongs to a customer and says so: its name starts with that
customer's name. Every run reports the rows where a transaction's customer and
its project disagree — a typing slip that will quietly mis-state either that
customer's statement or that project's profit, and which no total will ever
reveal. Internal work (salaries, zakah, the owners' own spending, transfers
between our accounts) carries no customer, so a row naming both a customer and
an internal project is reported too.

The reverse is checked separately and matters more: an invoice or a payment
filed under no customer never reaches anybody's statement. Cost rows without a
customer are normal and are not reported — a cost is carried by its project.

## Reading the run

The converter prints what it dropped and why, the transaction count by type, the
totals per currency, the accounts it created, and a list of flags — rows that
need a human eye. `validate.js` then prints the account balances, the customer
balances, the movement legs it could and could not pair, and the same figures
converted to USD.
