#!/usr/bin/env python3
"""
Convert the EnvironmSafe Excel workbook into a backup file the app can merge.

    python3 tools/import_workbook.py <workbook.xlsx> [-o environmsafe-import.json]

The workbook's Daily_Transactions sheet is the only sheet carrying data; the
master sheets are empty, so customers, suppliers, employees, projects and
accounts are derived from the text used in the transactions and de-duplicated
case-insensitively.

Decisions applied (agreed with the company):
  * money never crosses currencies — the account name carries it (USD-Kur → USD)
  * "DEBIT" rows are owner drawings, not a business cost
  * "GUARANTEE" rows are refundable deposits, not a cost
  * "EnvironmSafe", "GENERAL EXPEN", "INTERNAL TRANSFER" and "PEDDY CASH" are
    not trading parties and never become customers or suppliers
  * the spreadsheet total row (account "Total") is not a transaction
"""

import argparse, datetime, json, re, sys, unicodedata
from collections import OrderedDict

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required:  pip install openpyxl")

NOT_A_PARTY = {
    "environmsafe", "general expen", "general expenses", "internal transfer",
    "intrenal transfer", "peddy cash", "petty cash", "total", "0", "",
}

# account-name fragment -> bank in the app's list
BANKS = [("KUR", "Al Kuraimi"), ("QUT", "Al Quataibi"), ("TAD", "Tadhamon")]


def clean(v):
    """Trim, drop byte-order marks and collapse whitespace."""
    if v is None:
        return ""
    s = unicodedata.normalize("NFKC", str(v)).replace("﻿", "").strip()
    return re.sub(r"\s+", " ", s)


def money(v):
    try:
        return round(float(str(v).replace(",", "").strip() or 0), 2)
    except (TypeError, ValueError):
        return 0.0


MONTHS = {m: i + 1 for i, m in enumerate(
    ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}


def parse_date(v):
    """Excel dates, ISO text and '14 DEC 2025' all reduce to YYYY-MM-DD."""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    s = clean(v)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return "%s-%s-%s" % m.groups()
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$", s)
    if m and m.group(2).upper() in MONTHS:
        return "%s-%02d-%02d" % (m.group(3), MONTHS[m.group(2).upper()], int(m.group(1)))
    return ""


def currency_of(account):
    a = account.upper()
    for c in ("USD", "SAR", "YER", "AED"):
        if c in a:
            return c
    if "VISA" in a:
        return "USD"          # the company's Visa cards are held in USD
    return ""


def account_kind(name):
    n = name.upper()
    if "VISA" in n:
        return "Visa card"
    if "PEDDY" in n or "PED" in n or "CASH" in n:
        return "Cash"
    return "Bank"


def bank_of(name):
    n = name.upper()
    for frag, bank in BANKS:
        if frag in n:
            return bank
    return "Other"


# Imported records start at 1001 so they can never collide with the accounts and
# categories the app seeds on a fresh device (ACC-0001…), which would otherwise
# attach imported transactions to the wrong account.
ID_OFFSET = 1000


class Registry:
    """Assigns stable IDs and merges names that differ only by case."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.by_key = OrderedDict()

    def get(self, name, **extra):
        key = clean(name).lower()
        if not key or key in NOT_A_PARTY:
            return ""
        if key not in self.by_key:
            rec = {"id": "%s-%04d" % (self.prefix, ID_OFFSET + len(self.by_key) + 1),
                   "nameEn": clean(name)}
            rec.update(extra)
            self.by_key[key] = rec
        return self.by_key[key]["id"]

    def rows(self, stamp):
        out = []
        for r in self.by_key.values():
            r = dict(r)
            r.setdefault("notes", "Imported from the Excel workbook")
            r["createdAt"] = r["updatedAt"] = stamp
            out.append(r)
        return out


def map_type(kind, debit, credit, has_customer, has_supplier, has_employee):
    """The sheet records direction, not accounting side: Debit = money out."""
    out, inn = debit > 0, credit > 0
    k = kind.upper()

    if k == "INVOICE OUT":
        return "INVOICE OUT"                     # customer invoice, held on the *-INV account
    if k == "SALARY":
        return "SALARY"
    if k == "DEBIT":
        return "OWNER DRAWINGS"
    if k == "GUARANTEE":
        return "DEPOSIT RETURNED" if inn else "DEPOSIT PAID"
    if k == "TRANSFER":
        return "TRANSFER IN" if inn else "TRANSFER OUT"
    if k in ("PEDDY CASH", "PETTY CASH"):
        return "TRANSFER IN" if inn else "TRANSFER OUT"
    if k == "EXPENSE":
        if inn:
            return "RECEIPT" if has_customer else "TRANSFER IN"
        return "PAYMENT OUT" if has_supplier else "EXPENSE"
    if k == "PAYMENT":
        if inn:
            return "RECEIPT"
        return "PAYMENT OUT" if has_supplier else "EXPENSE"
    return "OTHER"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workbook")
    ap.add_argument("-o", "--out", default="environmsafe-import.json")
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
    ws = wb["Daily_Transactions"]
    rows = list(ws.iter_rows(min_row=5, values_only=True))
    header = [clean(h) for h in rows[0]]
    records = [dict(zip(header, r)) for r in rows[1:] if clean(r[0])]

    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    customers, suppliers = Registry("CUS"), Registry("SUP")
    employees, projects, accounts = Registry("EMP"), Registry("PRJ"), Registry("ACC")

    transactions, skipped = [], {"no amount": 0, "total row": 0, "no date": 0}
    seq = 0

    for r in records:
        debit, credit = money(r.get("Debit (Money Out)")), money(r.get("Credit (Money In)"))
        acct_name = clean(r.get("Bank / Cash Account"))
        if acct_name.lower() == "total":
            skipped["total row"] += 1
            continue
        if not debit and not credit:
            skipped["no amount"] += 1
            continue
        date = parse_date(r.get("Transaction Date"))
        if not date:
            skipped["no date"] += 1
            continue

        cur = currency_of(acct_name) or "YER"
        cust_id = customers.get(r.get("Customer"), opening=0)
        supp_id = suppliers.get(r.get("Supplier"), opening=0)
        emp_id = employees.get(r.get("Employee"))
        proj_id = projects.get(r.get("Project NAME") or r.get("Project-ID"), status="Open")

        kind = clean(r.get("Transaction Type"))
        ttype = map_type(kind, debit, credit, bool(cust_id), bool(supp_id), bool(emp_id))

        # The *-INV names are the invoice register, not a bank: a customer invoice
        # is not cash, so no account is created or referenced for those rows.
        acct_id = ""
        if acct_name and acct_name != "0" and ttype != "INVOICE OUT":
            acct_id = accounts.get(acct_name, nameAr="", kind=account_kind(acct_name),
                                   bank=bank_of(acct_name), currency=cur, opening=0)

        amount = debit or credit
        side_debit = ttype in ("INVOICE IN", "PAYMENT OUT", "EXPENSE", "SALARY",
                               "ADVANCE TO EMPLOYEE", "LOAN OUT", "TRANSFER OUT",
                               "OWNER DRAWINGS", "DEPOSIT PAID", "OTHER")

        note = clean(r.get("Notes"))
        if note in ("0",):
            note = ""
        original = "Excel %s · %s" % (clean(r.get("Transaction ID")), kind)

        seq += 1
        transactions.append({
            "id": "TRX-%06d" % (ID_OFFSET + seq),
            "date": date,
            "type": ttype,
            "phase": {"INVOICE OUT": "INVOICE OUT", "RECEIPT": "PAYMENT",
                      "PAYMENT OUT": "PAYMENT"}.get(ttype, "OTHER"),
            "caseNo": clean(r.get("Project NAME")) or "",
            "customerId": cust_id,
            "supplierId": supp_id,
            "employeeId": emp_id,
            "projectId": proj_id,
            "accountId": acct_id,
            "categoryId": "",
            "itemId": "", "qty": 0, "unitPrice": 0, "isAsset": "No",
            "currency": cur,
            "debit": amount if side_debit else 0,
            "credit": 0 if side_debit else amount,
            "status": clean(r.get("Status")).title() or "Approved",
            "refNo": clean(r.get("Reference No")),
            "docType": clean(r.get("Document Type")),
            "docRef": clean(r.get("Document Reference")) if clean(r.get("Document Reference")) != "0" else "",
            "notes": " · ".join(x for x in (note, original) if x),
            "createdBy": "excel-import",
            "createdAt": stamp, "updatedAt": stamp,
        })

    seqs = {"CUS": ID_OFFSET + len(customers.by_key), "SUP": ID_OFFSET + len(suppliers.by_key),
            "EMP": ID_OFFSET + len(employees.by_key), "PRJ": ID_OFFSET + len(projects.by_key),
            "ACC": ID_OFFSET + len(accounts.by_key), "TRX": ID_OFFSET + seq}

    out = {
        "meta": {"seq": seqs, "created": stamp, "device": "excel-import",
                 "importedFrom": args.workbook},
        "users": [],
        "items": [], "assets": [],
        "customers": customers.rows(stamp),
        "suppliers": suppliers.rows(stamp),
        "employees": employees.rows(stamp),
        "projects": projects.rows(stamp),
        "accounts": accounts.rows(stamp),
        "categories": [],
        "transactions": transactions,
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)

    print("wrote %s" % args.out)
    print("  transactions %d   customers %d   suppliers %d   employees %d   projects %d   accounts %d"
          % (seq, len(customers.by_key), len(suppliers.by_key), len(employees.by_key),
             len(projects.by_key), len(accounts.by_key)))
    print("  skipped: " + ", ".join("%s %d" % (k, v) for k, v in skipped.items()))

    per_cur = {}
    for t in transactions:
        b = per_cur.setdefault(t["currency"], [0.0, 0.0])
        b[0] += t["debit"]; b[1] += t["credit"]
    for c, (d, k) in sorted(per_cur.items()):
        print("  {:<4} debit {:>16,.2f}   credit {:>16,.2f}".format(c, d, k))


if __name__ == "__main__":
    main()
