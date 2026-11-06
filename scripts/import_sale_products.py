#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从「2026年主播售卖表」抽取「主播 × 日期 × 商品」粒度的售卖明细。

源表 59 个工作表：4 个汇总表 + 53 张主播明细表（每表 29 列，A~AC）。
主播表的列结构固定：
  A 主播名称 B 日期 C 直播类型 D 库存编码 E 类目 F 商品ID G 商品名称 H 商品图片
  I 售卖群 J 商品价格 K 佣金 L 成本
  M 当日销量 N 当日销售额 O 当日利润
  P 次日销量 Q 次日销售额 R 次日利润 S 次日退货率
  T 7日销量 U 7日销售额 V 7日利润
  W 30日销量 X 30日销售额 Y 30日结算率 Z 30日利润
  AA 结算销量 AB 结算销售额 AC 结算利润

本脚本只抽商品级关键列，商品名/类目/价格做字典去重，主播用索引，压缩产物体积。

用法：
    python scripts/import_sale_products.py --file "D:\\...\\2026年主播售卖表.xlsx"
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from import_sale_detail import (  # noqa: E402
    NS,
    cell_text,
    col_to_num,
    load_shared,
    read_rows,
    serial_to_date,
    sheet_paths,
    to_num,
)

SKIP_SHEETS = {"模板", "月度汇总", "月度结算汇总", "单场汇总", "汇总数据1", "WpsReserved_CellImgList"}

# 主播表列号（1-based）
C_ANCHOR, C_DATE, C_TYPE, C_CAT, C_NAME, C_PRICE = 1, 2, 3, 5, 7, 10
C_QTY, C_SALES, C_PROFIT, C_RET = 13, 14, 15, 19
C_D7QTY, C_D7SALES = 20, 21
C_STQTY, C_STSALES, C_STPROFIT = 27, 28, 29


def build_products(z, paths, shared):
    prod_index = {}      # (name, cat, price) -> pid
    products = []        # [{"name","cat","price"}]
    anchors_seen = {}
    anchors = []         # 主播名
    items = []           # 明细
    skipped = 0

    for sheet, path in paths.items():
        if sheet in SKIP_SHEETS:
            continue
        n_rows = 0
        for r in read_rows(z, path, shared):
            name = (r.get(C_NAME) or "").strip()
            date = serial_to_date(r.get(C_DATE))
            anchor = (r.get(C_ANCHOR) or "").strip()
            if not name or not anchor or not date or len(date) < 10:
                skipped += 1
                continue
            qty = to_num(r.get(C_QTY))
            sales = to_num(r.get(C_SALES))
            if qty == 0 and sales == 0:
                # 完全没卖动的商品行不进明细，避免一堆空行
                skipped += 1
                continue

            cat = (r.get(C_CAT) or "").strip()
            price = round(to_num(r.get(C_PRICE)), 2)
            key = (name, cat, price)
            pid = prod_index.get(key)
            if pid is None:
                pid = len(products)
                prod_index[key] = pid
                products.append({"name": name, "cat": cat, "price": price})

            aid = anchors_seen.get(anchor)
            if aid is None:
                aid = len(anchors)
                anchors_seen[anchor] = aid
                anchors.append(anchor)

            items.append([
                date,
                aid,
                (r.get(C_TYPE) or "").strip(),
                pid,
                round(qty),
                round(sales, 2),
                round(to_num(r.get(C_PROFIT)), 2),
                round(to_num(r.get(C_RET)) * 100, 2),
                round(to_num(r.get(C_D7SALES)), 2),
                round(to_num(r.get(C_STSALES)), 2),
            ])
            n_rows += 1
        print("  %-22s 有效 %5d 行" % (sheet[:20], n_rows), flush=True)

    return products, anchors, items, skipped


def summarize(products, anchors, items):
    dates = sorted({it[0] for it in items})
    by_date, by_anchor, by_product = {}, {}, {}
    total_sales = total_qty = total_profit = 0.0
    rr_sum, rr_n = 0.0, 0
    for date, aid, typ, pid, qty, sales, profit, ret, d7, st in items:
        total_sales += sales
        total_qty += qty
        total_profit += profit
        if ret > 0:
            rr_sum += ret
            rr_n += 1
        a = by_date.setdefault(date, {"date": date, "sales": 0.0, "qty": 0, "profit": 0.0, "skus": 0, "anchors": set()})
        a["sales"] += sales; a["qty"] += qty; a["profit"] += profit; a["skus"] += 1; a["anchors"].add(aid)
        b = by_anchor.setdefault(aid, {"anchor": anchors[aid], "sales": 0.0, "qty": 0, "profit": 0.0, "skus": 0, "days": set()})
        b["sales"] += sales; b["qty"] += qty; b["profit"] += profit; b["skus"] += 1; b["days"].add(date)
        c = by_product.setdefault(pid, {"name": products[pid]["name"], "cat": products[pid]["cat"], "sales": 0.0, "qty": 0, "profit": 0.0, "anchors": set()})
        c["sales"] += sales; c["qty"] += qty; c["profit"] += profit; c["anchors"].add(aid)

    for a in by_date.values():
        a["anchors"] = len(a["anchors"])
    for b in by_anchor.values():
        b["days"] = len(b["days"])
        b["avgSales"] = round(b["sales"] / max(1, b["days"]), 2)
    for c in by_product.values():
        c["anchors"] = len(c["anchors"])

    return {
        "dateFrom": dates[0] if dates else "",
        "dateTo": dates[-1] if dates else "",
        "days": len(dates),
        "anchors": len(anchors),
        "skus": len(products),
        "records": len(items),
        "sales": round(total_sales, 2),
        "qty": int(total_qty),
        "profit": round(total_profit, 2),
        "avgPrice": round(total_sales / total_qty, 2) if total_qty else 0,
        "marginRate": round(total_profit / total_sales * 100, 2) if total_sales else 0,
        "avgReturnRate": round(rr_sum / rr_n, 2) if rr_n else 0,
    }, sorted(by_date.values(), key=lambda x: x["date"]), \
        sorted(by_anchor.values(), key=lambda x: -x["sales"]), \
        sorted(by_product.values(), key=lambda x: -x["sales"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="售卖表 xlsx 路径")
    ap.add_argument("--out", default=os.path.join("data", "imports", "saleProducts.json"))
    args = ap.parse_args()

    src = args.file
    if not os.path.exists(src):
        print("找不到文件：" + src)
        return 2
    print("读取 %s（%.2f GB）" % (os.path.basename(src), os.path.getsize(src) / 1024 ** 3), flush=True)

    import zipfile
    z = zipfile.ZipFile(src)
    shared = load_shared(z)
    paths = sheet_paths(z)
    print("工作表 %d 个，开始逐表抽取商品明细…" % len(paths), flush=True)

    products, anchors, items, skipped = build_products(z, paths, shared)
    print("商品 %d 个 / 主播 %d 位 / 明细 %d 行（跳过 %d 行空行或零销量）" % (
        len(products), len(anchors), len(items), skipped), flush=True)

    summary, by_date, by_anchor, by_product = summarize(products, anchors, items)
    payload = {
        "source": "2026年主播售卖表（10-12月）-第一分公司",
        "sheet": "各主播明细表（A~AC 列）",
        "summary": summary,
        "anchors": anchors,
        "products": products,
        "items": items,
        "byDate": by_date,
        "byAnchor": by_anchor,
        "byProduct": by_product[:300],
    }
    out = args.out
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print("写出 %s（%.1f KB）" % (out, os.path.getsize(out) / 1024), flush=True)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
