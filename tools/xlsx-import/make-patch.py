#!/usr/bin/env python3
"""Write a correction file: the few fields that changed between two workbooks.

A correction file is not a backup. It names transactions by the workbook's own
Transaction ID and lists only the fields to put right, so the live system can
apply it without touching anything else — including edits made there by hand.

    python3 make-patch.py <old.xlsx> <new.xlsx>  ->  environmsafe-corrections.json
"""
import openpyxl, json, sys, datetime

if len(sys.argv) < 3:
    sys.exit("usage: python3 make-patch.py <old.xlsx> <new.xlsx>")
OLD, NEW = sys.argv[1], sys.argv[2]

def S(v):
    t = "" if v is None else str(v).replace("﻿", "").strip()
    return "" if t in ("0", "None") else t

def load(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Daily_Transactions"]
    it = ws.iter_rows(min_row=5, max_col=26, values_only=True)
    hdr = ["" if x is None else str(x).strip() for x in next(it)]
    idx = {h: i for i, h in enumerate(hdr) if h}
    rows = {}
    for r in it:
        if not any(v is not None and str(v).strip() for v in r): continue
        tid = S(r[idx["Transaction ID"]]) if "Transaction ID" in idx else ""
        if tid: rows[tid] = {h: (r[i] if i < len(r) else None) for h, i in idx.items()}
    return rows

old, new = load(OLD), load(NEW)

def numv(v):
    try: return round(float(v), 2)
    except (TypeError, ValueError): return 0.0

def datev(v):
    import datetime, re
    if isinstance(v, datetime.datetime): return v.date().isoformat()
    if isinstance(v, datetime.date): return v.isoformat()
    t = S(v)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    return m.group(0) if m else ""

# The workbook's Project-ID is what the system stores as the project's name:
# that is the column the converter builds projects from.
#
# Each correction also carries the date and the amount of the row it is talking
# about. The workbook numbers its rows and the system numbers its own, and the
# two drift apart wherever the workbook has a blank row — TRX-000399 in the
# sheet is TRX-0394 in the system. Matching is by the reference the record was
# imported with, which is the workbook's, but the date and the amount are
# checked as well, so a correction that somehow found the wrong record is
# refused instead of applied.
changes = []
for tid in sorted(set(old) & set(new)):
    a, b = S(old[tid].get("Project-ID")), S(new[tid].get("Project-ID"))
    if a != b and b:
        r = new[tid]
        changes.append({
            "sourceRef": tid, "was": a, "project": b,
            "date": datev(r.get("Transaction Date")),
            "amount": abs(numv(r.get("Debit (Money Out)"))) or abs(numv(r.get("Credit (Money In)"))),
        })

patch = {
    "kind": "environmsafe-corrections",
    "version": 1,
    "created": datetime.datetime.utcnow().isoformat() + "Z",
    "note": "Project corrected on {} transactions. Every other field is left alone.".format(len(changes)),
    "fields": ["projectId"],
    "match": ["sourceRef", "date", "amount"],
    "rows": changes,
}
json.dump(patch, open("environmsafe-corrections.json", "w"), ensure_ascii=False, indent=1)

print(f"{len(changes)} corrections written to environmsafe-corrections.json")
print(f"range: {changes[0]['sourceRef']} .. {changes[-1]['sourceRef']}" if changes else "")
seen = {}
for c in changes: seen.setdefault(c["project"], 0); seen[c["project"]] += 1
print(f"\n{len(seen)} distinct projects referenced:")
for p, n in sorted(seen.items(), key=lambda kv: -kv[1]):
    print(f"  {n:>3}  {p}")
