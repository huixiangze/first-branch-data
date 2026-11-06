#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从「2026年主播售卖表」抽取主播每日售卖明细，生成前端可直接用的轻量 JSON。

源表特点：1.8GB、59 个工作表（4 个汇总 + 52 个主播明细 + 图片表），
其中「单场汇总」是 主播 × 日期 × 直播类型 的粒度的扁平表，正好用来做明细页。
本脚本只流式读这一张表（+「月度结算汇总」），不整本进内存。

用法：
    python scripts/import_sale_detail.py --file "D:\\...\\2026年主播售卖表.xlsx"
    python scripts/import_sale_detail.py --file x.xlsx --out data/imports/saleDetail.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RELNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
EPOCH = dt.date(1899, 12, 30)

SHEET_DETAIL = "单场汇总"
SHEET_SETTLE = "月度结算汇总"


def col_to_num(ref):
    m = re.match(r"([A-Z]+)", ref or "")
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n


def load_shared(z):
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml"), events=("end",)):
            if el.tag == NS + "si":
                shared.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    return shared


def sheet_paths(z):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rmap = {r.get("Id"): r.get("Target") for r in rels}
    out = {}
    for sh in wb.find(NS + "sheets"):
        tgt = rmap.get(sh.get(RELNS + "id"), "")
        if not tgt.startswith("xl/"):
            tgt = "xl/" + tgt.lstrip("/")
        out[sh.get("name")] = tgt
    return out


def cell_text(c, shared):
    t = c.get("t")
    v = c.find(NS + "v")
    if t == "s" and v is not None:
        i = int(v.text or 0)
        return shared[i] if i < len(shared) else ""
    if t == "inlineStr":
        return "".join(x.text or "" for x in c.iter(NS + "t"))
    if v is not None:
        return v.text or ""
    return ""


def to_num(v):
    if v is None:
        return 0.0
    s = str(v).replace(",", "").replace("¥", "").replace("%", "").strip()
    if not s:
        return 0.0
    try:
        x = float(s)
    except ValueError:
        return 0.0
    return x


def serial_to_date(v):
    n = to_num(v)
    if 20000 < n < 80000:
        return (EPOCH + dt.timedelta(days=int(n))).isoformat()
    s = str(v or "").strip()
    m = re.match(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return s


def read_rows(z, path, shared):
    """流式产出每行的 {列号: 文本}。"""
    with z.open(path) as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag == NS + "row":
                row = {}
                for c in el.iter(NS + "c"):
                    idx = col_to_num(c.get("r"))
                    row[idx] = cell_text(c, shared)
                yield row
                el.clear()


def build_detail(rows):
    """返回明细行列表 + 汇总。"""
    out = []
    for r in rows:
        anchor = (r.get(1) or "").strip()
        date = serial_to_date(r.get(2))
        if not anchor or not date or not re.match(r"\d{4}-\d{2}-\d{2}", date):
            continue
        qty = to_num(r.get(4))
        sales = to_num(r.get(5))
        profit = to_num(r.get(6))
        out.append({
            "anchor": anchor,
            "date": date,
            "type": (r.get(3) or "").strip(),
            "qty": round(qty),
            "sales": round(sales, 2),
            "profit": round(profit, 2),
            "nxQty": round(to_num(r.get(7))),
            "nxSales": round(to_num(r.get(8)), 2),
            "nxProfit": round(to_num(r.get(9)), 2),
            "returnRate": round(to_num(r.get(10)) * 100, 2),
            "d7Qty": round(to_num(r.get(11))),
            "d7Sales": round(to_num(r.get(12)), 2),
            "d7Profit": round(to_num(r.get(13)), 2),
            "stQty": round(to_num(r.get(14))),
            "stSales": round(to_num(r.get(15)), 2),
            "stProfit": round(to_num(r.get(16)), 2),
        })
    return out


def summarize(detail):
    dates = sorted({d["date"] for d in detail})
    by_date, by_anchor = {}, {}
    for d in detail:
        a = by_date.setdefault(d["date"], {"date": d["date"], "sales": 0.0, "qty": 0, "profit": 0.0, "anchors": 0, "_rr": 0.0})
        a["sales"] += d["sales"]; a["qty"] += d["qty"]; a["profit"] += d["profit"]
        a["anchors"] += 1
        a["_rr"] += d["returnRate"]
        b = by_anchor.setdefault(d["anchor"], {"anchor": d["anchor"], "days": 0, "sales": 0.0, "qty": 0, "profit": 0.0, "_rr": 0.0})
        b["days"] += 1; b["sales"] += d["sales"]; b["qty"] += d["qty"]; b["profit"] += d["profit"]
        b["_rr"] += d["returnRate"]
    for a in by_date.values():
        a["returnRate"] = round(a["_rr"] / max(1, a["anchors"]), 2)
        a["days"] = 1
        a.pop("_rr", None)
        a.pop("anchors", None)
    for b in by_anchor.values():
        b["returnRate"] = round(b["_rr"] / max(1, b["days"]), 2)
        b["avgSales"] = round(b["sales"] / max(1, b["days"]), 2)
        b.pop("_rr", None)
    total_sales = sum(d["sales"] for d in detail)
    total_qty = sum(d["qty"] for d in detail)
    total_profit = sum(d["profit"] for d in detail)
    rr = [d["returnRate"] for d in detail if d["returnRate"] > 0]
    return {
        "asOf": dates[-1] if dates else "",
        "dateFrom": dates[0] if dates else "",
        "dateTo": dates[-1] if dates else "",
        "days": len(dates),
        "anchors": len(by_anchor),
        "records": len(detail),
        "sales": round(total_sales, 2),
        "qty": total_qty,
        "profit": round(total_profit, 2),
        "avgPrice": round(total_sales / total_qty, 2) if total_qty else 0,
        "marginRate": round(total_profit / total_sales * 100, 2) if total_sales else 0,
        "avgReturnRate": round(sum(rr) / len(rr), 2) if rr else 0,
        "settleSales": round(sum(d["stSales"] for d in detail), 2),
    }, sorted(by_date.values(), key=lambda x: x["date"]), sorted(by_anchor.values(), key=lambda x: -x["sales"])


def read_month_settle(z, path, shared):
    """月度结算汇总：r2 是表头，之后是主播行。"""
    rows = []
    for i, r in enumerate(read_rows(z, path, shared), start=1):
        if i <= 2:
            continue
        anchor = (r.get(1) or "").strip()
        if not anchor:
            continue
        rows.append({
            "anchor": anchor,
            "m10Gmv": round(to_num(r.get(2)), 2), "m10Profit": round(to_num(r.get(3)), 2),
            "m11Gmv": round(to_num(r.get(4)), 2), "m11Profit": round(to_num(r.get(5)), 2),
            "m12Gmv": round(to_num(r.get(6)), 2), "m12Profit": round(to_num(r.get(7)), 2),
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="售卖表 xlsx 路径")
    ap.add_argument("--out", default=os.path.join("data", "imports", "saleDetail.json"))
    args = ap.parse_args()

    src = args.file
    if not os.path.exists(src):
        print("找不到文件：" + src)
        return 2
    print("读取 %s（%.2f GB）" % (os.path.basename(src), os.path.getsize(src) / 1024 ** 3), flush=True)

    z = zipfile.ZipFile(src)
    shared = load_shared(z)
    paths = sheet_paths(z)
    if SHEET_DETAIL not in paths:
        print("缺少工作表：" + SHEET_DETAIL)
        return 3

    detail = build_detail(read_rows(z, paths[SHEET_DETAIL], shared))
    print("明细行 %d 条" % len(detail), flush=True)
    summary, by_date, by_anchor = summarize(detail)

    month = []
    if SHEET_SETTLE in paths:
        month = read_month_settle(z, paths[SHEET_SETTLE], shared)
        print("月度结算 %d 位主播" % len(month), flush=True)

    payload = {
        "asOf": summary["asOf"],
        "source": "2026年主播售卖表（10-12月）-第一分公司",
        "sheet": SHEET_DETAIL,
        "summary": summary,
        "byDate": by_date,
        "byAnchor": by_anchor,
        "monthSettle": month,
        "rows": detail,
    }
    out = args.out
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("写出 %s（%.1f KB）" % (out, os.path.getsize(out) / 1024), flush=True)
    print(json.dumps({k: summary[k] for k in ("dateFrom", "dateTo", "days", "anchors", "records", "sales", "qty", "profit", "avgPrice", "marginRate", "avgReturnRate")}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
