#!/usr/bin/env python3
"""Convert the EnvironmSafe workbook into a backup file the live system can merge.

Only rows carrying a real amount are treated as transactions; the workbook is a
15k-row template and all but a few hundred rows are empty scaffolding.
"""
import openpyxl, json, re, datetime, sys
from collections import Counter, defaultdict

if len(sys.argv) < 2:
    sys.exit("usage: python3 convert.py <workbook.xlsx>  ->  environmsafe-import.json")
F = sys.argv[1]
wb = openpyxl.load_workbook(F, read_only=True, data_only=True)
notes = []          # anything a human should look at
def flag(msg): notes.append(msg)

def sheet(name, hdr=5):
    ws = wb[name]; it = ws.iter_rows(min_row=hdr, values_only=True)
    head = [("" if x is None else str(x).strip()) for x in next(it)]
    rows = [r for r in it if any(v is not None and str(v).strip() != "" for v in r)]
    return head, rows

def s_(v):
    if v is None: return ""
    t = str(v).replace("﻿", "").strip()
    return "" if t in ("0", "None") else t

def numv(v):
    try: return float(v)
    except (TypeError, ValueError): return 0.0

# ---------- dates: the sheet mixes real dates with text like "20 DEC 2025" ----------
MONTHS = {m:i+1 for i,m in enumerate(
    ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"])}
def parse_date(v):
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    if isinstance(v, datetime.date):     return v.isoformat()
    t = str(v or "").replace("﻿", "").strip()
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$", t)
    if m and m.group(2).upper() in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(2).upper()]:02d}-{int(m.group(1)):02d}"
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m: return m.group(0)
    return ""

# ---------- names ----------
# The sheet spells the same party several ways. Two of these are not parties at
# all: the company itself, and the label used when money simply moved between our
# own accounts. Rows carrying them are not customer business, and are handled
# below as expenses or as account-to-account movement.
SELF     = {"ENVIRONMSAFE", "GENERAL", "GENERAL EXPEN", "GENERAL EXPENSES", "SUP-GENERAL"}
INTERNAL = {"INTERNAL TRANSFER", "INTRENAL TRANSFER", "PEDDY CASH", "PETTY CASH"}

def norm_name(v):
    """One spelling per party. 'Al Zailee' and 'Al  Zailee' are the same customer;
    'AL ZAILEE-ADEN' is a different one and keeps its own record."""
    n = re.sub(r"\s+", " ", s_(v)).strip()
    if not n: return ""
    up = n.upper()
    if up.startswith("AL ZAILEE") and "ADEN" not in up:
        return "Al Zailee"
    if up in ("AL ZAILEE-ADEN", "AL ZAILEE - ADEN", "AL ZAILEE ADEN"):
        return "AL ZAILEE-ADEN"
    if up in INTERNAL:
        return "INTERNAL TRANSFER"
    return n

is_self     = lambda v: re.sub(r"\s+"," ",s_(v)).strip().upper() in SELF
is_internal = lambda v: re.sub(r"\s+"," ",s_(v)).strip().upper() in INTERNAL

# ---------- accounts: currency lives in the label prefix ----------
BANKS = {"KUR":"Al Kuraimi", "QUT":"Al Quataibi", "TAD":"Tadhamon",
         "INV":"INV (unconfirmed)", "ROK":"ROK (unconfirmed)", "GEN":"General"}
def account_of(label):
    """-> (name, currency, kind) for a raw account label such as 'USD-Kur'."""
    lab = s_(label)
    if not lab or lab.lower() == "total": return None
    up = lab.upper()
    cur = next((c for c in ("USD","SAR","YER") if up.startswith(c)), "")
    kind = "Bank"
    if "VISA" in up:
        kind, cur = "Card", cur or "USD"      # company Visa cards are USD accounts
    elif "PEDDY" in up or "PED" in up.split("-")[-1:]:
        # The petty box is an account in its own right: money is moved into it,
        # spent from it, and whatever is left is its balance.
        kind = "Cash"
    if not cur:
        cur = "YER"
        flag(f"account {lab!r}: no currency in the label, assumed YER")
    return (lab, cur, kind)

# =====================================================================
# master data
# =====================================================================
db = {"meta":{"seq":{}, "created":datetime.datetime.utcnow().isoformat()+"Z",
              "device":"import-xlsx", "source":"EnvironmSafe workbook v4"},
      "users":[], "items":[], "assets":[], "customers":[], "suppliers":[],
      "employees":[], "projects":[], "accounts":[], "categories":[], "transactions":[]}

uid_n = [0]
def uid(): uid_n[0] += 1; return f"imp-{uid_n[0]:06d}"
def ident(prefix, n): return f"{prefix}-{n:04d}"

_h, cust_rows = sheet("Customers")
customers = {}                       # name(upper) -> record
for i, r in enumerate(cust_rows, 1):
    name = norm_name(r[1]) or norm_name(r[0])
    if not name: continue
    rec = {"id": ident("CUS", len(customers)+1), "uid": uid(), "nameEn": name,
           "nameAr": s_(r[2]), "contact": s_(r[3]), "phone": s_(r[4]), "email": s_(r[5]),
           "notes": f"workbook Customer_ID {s_(r[0])}" if s_(r[0]) else ""}
    customers.setdefault(name.upper(), rec)

_h, emp_rows = sheet("Employees")
employees = {}
for r in emp_rows:
    name = norm_name(r[1]) or norm_name(r[0])
    if not name: continue
    employees.setdefault(name.upper(), {"id": ident("EMP", len(employees)+1), "uid": uid(),
        "nameEn": name, "nameAr": s_(r[2]), "position": s_(r[3]), "phone": s_(r[4]), "email": s_(r[5])})

_h, proj_rows = sheet("Projects")
projects = {}
for r in proj_rows:
    name = norm_name(r[0]) or norm_name(r[1])
    if not name: continue
    projects.setdefault(name.upper(), {"id": ident("PRJ", len(projects)+1), "uid": uid(),
        "nameEn": name, "status":"active", "budget":0})

_h, cat_rows = sheet("Expense_Categories")
categories = {}
for r in cat_rows:
    name = norm_name(r[1]) or norm_name(r[0])
    if not name: continue
    categories.setdefault(name.upper(), {"id": ident("CAT", len(categories)+1), "uid": uid(),
        "nameEn": name, "nameAr": s_(r[2]), "kind":"Operations"})

_h, sup_rows = sheet("Suppliers")
suppliers = {}
for r in sup_rows:
    name = norm_name(r[1]) or norm_name(r[0])
    if not name: continue
    suppliers.setdefault(name.upper(), {"id": ident("SUP", len(suppliers)+1), "uid": uid(),
        "nameEn": name, "nameAr": s_(r[2]), "contact": s_(r[3]), "phone": s_(r[4]), "email": s_(r[5])})
if not suppliers:
    flag("the Suppliers sheet is empty; suppliers were created from the names used in transactions")

# =====================================================================
# transactions
# =====================================================================
ws = wb["Daily_Transactions"]
it = ws.iter_rows(min_row=5, max_col=26, values_only=True)
hdr = [("" if x is None else str(x).strip()) for x in next(it)]
idx = {h:i for i,h in enumerate(hdr)}
raw = [r for r in it if any(v is not None and str(v).strip() != "" for v in r)]
g = lambda r,h: (r[idx[h]] if h in idx and idx[h] < len(r) else None)

def is_total_row(r):
    """A summary line that leaked into the data, not a transaction: it carries
    both a debit and a credit and sits on the pseudo-account 'Total'."""
    lab = s_(g(r,"Bank / Cash Account")).lower()
    both = abs(numv(g(r,"Debit (Money Out)"))) > 0 and abs(numv(g(r,"Credit (Money In)"))) > 0
    return lab == "total" or (both and not lab)

real = [r for r in raw if (abs(numv(g(r,"Debit (Money Out)"))) > 0
                        or abs(numv(g(r,"Credit (Money In)"))) > 0)
                       and not is_total_row(r)]
dropped_totals = [r for r in raw if (abs(numv(g(r,"Debit (Money Out)"))) > 0
                        or abs(numv(g(r,"Credit (Money In)"))) > 0) and is_total_row(r)]
skipped_with_content = [r for r in raw if r not in real and any(
    s_(g(r,h)) for h in ["Customer","Supplier","Employee","Project-ID","Notes"])]

# file type -> app type, chosen by which column the amount sits in
TYPE_MAP = {
    "Payment":     {"credit":"RECEIPT",        "debit":"RECEIPT"},
    "Expense":     {"debit":"EXPENSE",         "credit":"REFUND FROM SUPPLIER"},
    "INVOICE OUT": {"debit":"INVOICE OUT",     "credit":"INVOICE OUT"},
    "Salary":      {"debit":"SALARY",          "credit":"SALARY"},
    "DEBIT":       {"debit":"OWNER DRAWINGS",  "credit":"LOAN IN"},
    "Transfer":    {"debit":"TRANSFER OUT",    "credit":"TRANSFER IN"},
    "GUARANTEE":   {"debit":"DEPOSIT PAID",    "credit":"DEPOSIT RETURNED"},
    "PEDDY CASH":  {"debit":"TRANSFER OUT",    "credit":"TRANSFER IN"},
}
# app side per type, so every row posts the way the app itself would post it
# The two owners. Money handed to them is a drawing; money handed to anyone
# else is an advance the company expects back.
OWNERS = ("AKRAM", "HAYEL")

SIDE = {"RECEIPT":"credit","EXPENSE":"debit","REFUND FROM SUPPLIER":"credit",
        "ADVANCE TO EMPLOYEE":"debit",
        "INVOICE OUT":"credit","SALARY":"debit","OWNER DRAWINGS":"debit","LOAN IN":"credit",
        "TRANSFER OUT":"debit","TRANSFER IN":"credit","DEPOSIT PAID":"debit",
        "DEPOSIT RETURNED":"credit","OTHER":"debit"}
STATUS_MAP = {"approved":"Approved","closed":"Closed","paid":"Paid",
              "cancelled":"Cancelled","partially paid":"Approved","draft":"Draft"}

accounts, unmapped_types, status_notes = {}, Counter(), Counter()
def want(table, key, factory):
    k = key.upper()
    if k not in table: table[k] = factory()
    return table[k]

# The rate a figure was worth in USD. The workbook carries no rate column, so
# every row gets the standing rate for its currency; a row whose real rate
# differed is corrected in the app afterwards, and that row's own rate then wins.
FX = {"USD": 1, "SAR": 3.75, "AED": 3.6725, "YER": 530}

UNDATED_FALLBACK = "2026-06-30"   # end of the period, agreed for the rows with no date

seq = 0
for r in real:
    seq += 1
    ftype = s_(g(r,"Transaction Type")) or "Other"
    d, c = numv(g(r,"Debit (Money Out)")), numv(g(r,"Credit (Money In)"))
    col = "debit" if abs(d) >= abs(c) else "credit"
    amount = abs(d) if col == "debit" else abs(c)

    # --- is this row our own money moving between our own accounts? ---
    # The label may sit in any of the party columns; the money never leaves the
    # company, so it is neither revenue nor cost — only a movement that has to
    # show on both account ledgers for their balances to be right.
    # The Customer or Supplier column saying "internal transfer", or the row's own
    # type being Transfer or PEDDY CASH, is what makes a row a movement. The
    # Project column is only a label: "Plastic Tank" bought from a real supplier
    # is an expense however the project happens to be named.
    movement = (is_internal(g(r,"Customer")) or is_internal(g(r,"Supplier"))
                or ftype.upper() in ("PEDDY CASH", "TRANSFER"))
    if movement:
        mapped = "TRANSFER OUT" if col == "debit" else "TRANSFER IN"
    elif ftype.upper() == "DEBIT" and col == "debit":
        # Money handed to a person. For the two owners it is theirs to take —
        # an owner drawing. For anyone else it is money the company is owed
        # back, so it is recorded as an advance and stays on that employee's
        # report until it is returned. A DEBIT naming nobody is not a drawing
        # by anyone: in this workbook it is a card charge that was reversed,
        # and it is treated as the movement its matching leg says it is.
        emp_up = s_(g(r,"Employee")).upper()
        if not emp_up:
            mapped = "TRANSFER OUT"
            movement = True
        else:
            mapped = "OWNER DRAWINGS" if any(o in emp_up for o in OWNERS) else "ADVANCE TO EMPLOYEE"
    else:
        mapped = TYPE_MAP.get(ftype, {}).get(col)
        if not mapped:
            mapped = "OTHER"; unmapped_types[f"{ftype}/{col}"] += 1
    # account (and therefore currency)
    acc_id, currency = "", "YER"
    a = account_of(g(r,"Bank / Cash Account"))
    if a:
        name, currency, kind = a
        rec = want(accounts, name, lambda: {"id": ident("ACC", len(accounts)+1), "uid": uid(),
            "nameEn": name, "kind": kind, "currency": currency, "opening": 0,
            "bank": BANKS.get(name.upper().split("-")[-1].strip(), "")})
        acc_id = rec["id"]
    # parties
    cust = norm_name(g(r,"Customer")); sup = norm_name(g(r,"Supplier")); emp = norm_name(g(r,"Employee"))
    # The company's own name in the Customer column means "this is ours" — an
    # expense, a salary or a drawing — not a sale. The row keeps whichever
    # supplier or employee it names, which is who the money actually went to.
    if is_self(cust) or is_internal(cust): cust = ""
    if is_internal(sup): sup = ""
    if movement: cust = sup = ""
    if is_self(sup): sup = "General expenses"
    cid = sid = eid = ""
    if cust:
        rec = want(customers, cust, lambda: {"id": ident("CUS", len(customers)+1), "uid": uid(),
            "nameEn": cust, "nameAr":"", "notes":"created from a transaction"})
        cid = rec["id"]
    if sup:
        rec = want(suppliers, sup, lambda: {"id": ident("SUP", len(suppliers)+1), "uid": uid(),
            "nameEn": sup, "nameAr":"", "notes":"created from a transaction"})
        sid = rec["id"]
    if emp:
        rec = want(employees, emp, lambda: {"id": ident("EMP", len(employees)+1), "uid": uid(),
            "nameEn": emp, "nameAr":"", "notes":"created from a transaction"})
        eid = rec["id"]
    proj = s_(g(r,"Project-ID")) or s_(g(r,"Project NAME"))
    pid = ""
    if proj:
        rec = want(projects, proj, lambda: {"id": ident("PRJ", len(projects)+1), "uid": uid(),
            "nameEn": proj, "status":"active", "budget":0})
        pid = rec["id"]
    cat = s_(g(r,"Expense Category")); catid = ""
    if cat:
        rec = want(categories, cat, lambda: {"id": ident("CAT", len(categories)+1), "uid": uid(),
            "nameEn": cat, "nameAr":"", "kind":"Operations"})
        catid = rec["id"]

    st_raw = s_(g(r,"Status")).lower()
    status = STATUS_MAP.get(st_raw, "Approved")
    if st_raw and st_raw not in STATUS_MAP: status_notes[st_raw] += 1
    if st_raw == "partially paid": status_notes["partially paid -> Approved"] += 1

    date = parse_date(g(r,"Transaction Date"))
    if not date:
        flag(f"row {s_(g(r,'Transaction ID'))}: no readable date, dated {UNDATED_FALLBACK}")
        date = UNDATED_FALLBACK

    side = SIDE.get(mapped, "debit")
    now = datetime.datetime.utcnow().isoformat()+"Z"
    db["transactions"].append({
        "id": ident("TRX", seq), "uid": uid(), "date": date,
        "type": mapped, "phase": s_(g(r,"Procurement Phase")) or "OTHER",
        "caseNo": "", "customerId": cid, "supplierId": sid, "employeeId": eid,
        "projectId": pid, "accountId": acc_id, "categoryId": catid, "itemId": "",
        "qty": 0, "unitPrice": 0, "discount": 0, "isAsset": "No", "currency": currency,
        "fxRate": FX.get(currency, 0),
        "debit":  amount if side == "debit"  else 0,
        "credit": amount if side == "credit" else 0,
        "status": status, "refNo": "", "againstRef": "",
        "docType": s_(g(r,"Document Type")), "docRef": s_(g(r,"Document Reference")),
        "notes": s_(g(r,"Notes")),
        "createdBy": "import", "createdAt": now, "updatedAt": now,
        "sourceRef": s_(g(r,"Transaction ID")),
    })

# ------------------------------------------------- opening balances at the cutoff
# The company started keeping its books here on 19 July 2025. Payments received
# before that date are in the workbook, but the invoices they settled are not —
# so every one of them reads as a customer paying for nothing, and the statement
# opens deep in credit. One invoice per customer per currency, dated the day
# before, restores the invoices that are missing and brings each customer to zero
# at the cutoff. They are marked plainly: nobody should mistake them for real
# documents, and each one says what it stands for.
OPEN_CUTOFF = "2025-07-19"
OPEN_REF    = "OPEN-" + OPEN_CUTOFF
OPEN_DATE   = "2025-07-18"

REVENUE_T  = {"INVOICE OUT"}
CASH_IN_T  = {"RECEIPT", "TRANSFER IN", "DEPOSIT RETURNED"}

opening_bal = defaultdict(float)
for x in db["transactions"]:
    if not x["customerId"] or x["date"] >= OPEN_CUTOFF: continue
    k = (x["customerId"], x["currency"])
    if   x["type"] in REVENUE_T: opening_bal[k] += x["debit"] + x["credit"]
    elif x["type"] in CASH_IN_T: opening_bal[k] -= x["debit"] + x["credit"]

opening_rows = []
for (cid, cur), v in sorted(opening_bal.items()):
    if abs(v) < 0.005: continue
    # A negative balance means they paid for invoices we do not have: raise them.
    # A positive one means we invoiced work whose payment is not in the sheet.
    kind   = "INVOICE OUT" if v < 0 else "RECEIPT"
    amount = abs(v)
    seq += 1
    now = datetime.datetime.utcnow().isoformat() + "Z"
    opening_rows.append({
        "id": ident("TRX", seq), "uid": uid(), "date": OPEN_DATE,
        "type": kind, "phase": "INVOICE OUT" if kind == "INVOICE OUT" else "PAYMENT",
        "caseNo": "", "customerId": cid, "supplierId": "", "employeeId": "",
        "projectId": "", "accountId": "", "categoryId": "", "itemId": "",
        "qty": 0, "unitPrice": 0, "discount": 0, "isAsset": "No", "currency": cur,
        "fxRate": FX.get(cur, 0),
        "debit":  amount if SIDE[kind] == "debit"  else 0,
        "credit": amount if SIDE[kind] == "credit" else 0,
        "status": "Approved", "refNo": OPEN_REF, "againstRef": "",
        "docType": "", "docRef": "",
        "notes": f"Opening balance at {OPEN_CUTOFF}. Stands for the {kind.lower()}s "
                 f"raised before the books started and not carried in the workbook; "
                 f"it brings this customer to zero at the cutoff. Not a real document.",
        "createdBy": "import", "createdAt": now, "updatedAt": now,
        "sourceRef": OPEN_REF,
    })
# An opening entry has no bank account, so it moves no money — only the balance.
db["transactions"].extend(opening_rows)

# ---------------------------------------------------------------- pair the legs
# A movement is two rows: one account loses the money, another gains it. Tying
# the two together lets the app show, from either ledger, where the money went.
by_key = defaultdict(list)
for x in db["transactions"]:
    if x["type"] in ("TRANSFER OUT", "TRANSFER IN"):
        by_key[(round(x["debit"] + x["credit"], 2), re.sub(r"\s+", " ", x["notes"]).strip().lower())].append(x)
paired = 0
for key, group in by_key.items():
    outs = [x for x in group if x["type"] == "TRANSFER OUT"]
    ins  = [x for x in group if x["type"] == "TRANSFER IN"]
    for a, b in zip(outs, ins):
        if a["accountId"] and b["accountId"]:
            a["againstRef"], b["againstRef"] = b["id"], a["id"]
            paired += 1
# Second pass for the legs whose two rows were described differently: same money,
# same currency, opposite direction, within a week of each other.
loose = [x for x in db["transactions"]
         if x["type"] in ("TRANSFER OUT","TRANSFER IN") and not x["againstRef"]]
def days(a, b):
    return abs((datetime.date.fromisoformat(a["date"]) - datetime.date.fromisoformat(b["date"])).days)
for a_ in [x for x in loose if x["type"] == "TRANSFER OUT"]:
    if a_["againstRef"]: continue
    for b_ in [x for x in loose if x["type"] == "TRANSFER IN" and not x["againstRef"]]:
        # The two legs may sit on the same account — money put up as a guarantee
        # and returned when the tender was cancelled comes back where it left.
        if (round(a_["debit"], 2) == round(b_["credit"], 2) and a_["currency"] == b_["currency"]
                and days(a_, b_) <= 7):
            a_["againstRef"], b_["againstRef"] = b_["id"], a_["id"]
            paired += 1
            break
still = [x for x in db["transactions"]
         if x["type"] in ("TRANSFER OUT","TRANSFER IN") and not x["againstRef"]]
unpaired = len(still)
for x in still:
    x["notes"] = (x["notes"] + " | movement with no matching leg in the workbook — please check").strip(" |")
    flag(f"{x['sourceRef']} {x['type']} {x['debit']+x['credit']:,.0f} {x['currency']}: no matching leg")

db["meta"]["fx"] = FX

for t, tbl in (("customers",customers),("suppliers",suppliers),("employees",employees),
               ("projects",projects),("categories",categories),("accounts",accounts)):
    db[t] = list(tbl.values())
for pre, t in (("CUS","customers"),("SUP","suppliers"),("EMP","employees"),
               ("PRJ","projects"),("CAT","categories"),("ACC","accounts"),("TRX","transactions")):
    db["meta"]["seq"][pre] = len(db[t])

json.dump(db, open("environmsafe-import.json","w"), ensure_ascii=False, indent=1)

# ---------------------------------------------------------------- report
undated = [x for x in db["transactions"] if not x["date"]]
print(f"workbook rows scanned          : {len(raw):,}")
print(f"summary/total rows discarded   : {len(dropped_totals)}")
for r in dropped_totals:
    print(f"     dropped {s_(g(r,'Transaction ID'))}  account={s_(g(r,'Bank / Cash Account'))!r}"
          f"  debit={numv(g(r,'Debit (Money Out)')):,.2f}  credit={numv(g(r,'Credit (Money In)')):,.2f}")
print(f"transactions with no usable date: {len(undated)}")
for x in undated:
    print(f"     {x['sourceRef']}  {x['type']}  {x['debit'] or x['credit']:,.2f} {x['currency']}  {x['notes'][:44]}")
print(f"rows with a real amount        : {len(real):,}")
print(f"rows skipped as empty template : {len(raw)-len(real):,}")
print(f"  of those, carrying some text : {len(skipped_with_content)}")
print()
for t in ("transactions","customers","suppliers","employees","projects","accounts","categories"):
    print(f"  {t:<13} {len(db[t]):>5}")
print(f"\nopening entries at {OPEN_CUTOFF}   : {len(opening_rows)}")
for x in opening_rows:
    who = next((c["nameEn"] for c in db["customers"] if c["id"] == x["customerId"]), x["customerId"])
    print(f"     {who:<22} {x['type']:<12} {x['debit']+x['credit']:>16,.2f} {x['currency']}")
print(f"\nmovement legs paired           : {paired} pairs, {unpaired} legs with no partner")
print("\n-- transactions by mapped type --")
for t,k in Counter(x["type"] for x in db["transactions"]).most_common():
    print(f"  {k:>5}  {t}")
print("\n-- totals per currency (never summed across) --")
per = defaultdict(lambda: [0.0,0.0])
for x in db["transactions"]:
    per[x["currency"]][0] += x["debit"]; per[x["currency"]][1] += x["credit"]
for cur,(dd,cc) in sorted(per.items()):
    print(f"  {cur}   debit {dd:>16,.2f}   credit {cc:>16,.2f}")
print("\n-- accounts created --")
for a in sorted(db["accounts"], key=lambda a:a["nameEn"]):
    print(f"  {a['currency']}  {a['kind']:<5} {a['nameEn']:<18} {a['bank']}")
if unmapped_types:
    print("\n!! unmapped type/column combinations:", dict(unmapped_types))
if status_notes:
    print("\n!! status notes:", dict(status_notes))
# ---------------------------------------------------------------------------
# House rule: a project belongs to a customer, and says so — its name starts
# with the customer's name. A row whose customer and project disagree is a
# typing slip somewhere, and the wrong one will quietly mis-state either that
# customer's statement or that project's profit. Checked on every run.
# Internal work — salaries, zakah, the owners' own spending, transfers between
# our accounts — has no customer at all, so those projects never carry one. That
# makes a row naming BOTH a customer and an internal project just as wrong as one
# naming the wrong customer, and it is reported too rather than waved through.
cust_names = sorted((c["nameEn"].upper().strip() for c in db["customers"]), key=len, reverse=True)
def project_owner(pname):
    up = re.sub(r"\s+", " ", pname).upper().strip()
    return next((c for c in cust_names if up.startswith(c)), "")

proj_name = {p["id"]: p["nameEn"] for p in db["projects"]}
cust_name = {c["id"]: c["nameEn"] for c in db["customers"]}
rule_breaks = []
for x in db["transactions"]:
    if not x["customerId"] or not x["projectId"]: continue
    cn = cust_name.get(x["customerId"], "").upper().strip()
    pn = re.sub(r"\s+", " ", proj_name.get(x["projectId"], "")).upper().strip()
    if pn.startswith(cn): continue
    rule_breaks.append((x["sourceRef"], x["type"], cust_name[x["customerId"]],
                        proj_name[x["projectId"]], project_owner(proj_name[x["projectId"]])))

print(f"\n-- project/customer rule: {len(rule_breaks)} rows where the project does not "
      f"start with the customer's name --")
for ref, ty, cn, pn, owner in rule_breaks:
    print(f"   {ref:<12} {ty:<12} customer {cn[:26]:<26} project {pn[:26]:<26}"
          f" -> {owner or 'names no customer'}")

# The reverse worry — money a customer owes us, filed under nobody — is worse,
# because it never reaches their statement at all. Cost rows are fine without a
# customer: they are carried by the project.
orphan = [x for x in db["transactions"]
          if not x["customerId"] and x["type"] in ("INVOICE OUT", "RECEIPT")
          and x["projectId"] and project_owner(proj_name.get(x["projectId"], ""))]
print(f"-- invoices and receipts with no customer, whose project names one: {len(orphan)} --")
for x in orphan:
    print(f"   {x['sourceRef']:<12} {x['type']:<12} {proj_name[x['projectId']]}")

if notes:
    print(f"\n!! {len(notes)} flags:")
    for n in notes[:12]: print("   -", n)
