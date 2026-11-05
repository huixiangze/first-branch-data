#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《2026年11月第一分公司电商主播昨日结算数据.xlsx》整本工作簿解析成
数据中台可直接入库的 bundle.json（多模块 payload）。

零依赖，仅用标准库。
用法： python import_workbook.py <xlsx> <out_bundle.json>
"""
import zipfile, xml.etree.ElementTree as ET, sys, json, re
from datetime import date, timedelta

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def colnum(ref):
    m = re.match(r'[A-Z]+', ref or '')
    if not m:
        return 0
    n = 0
    for ch in m.group():
        n = n * 26 + (ord(ch) - 64)
    return n


def parse_sheet(z, path, ss):
    ws = ET.fromstring(z.read(path))
    rows = []
    for row in ws.iter(NS + 'row'):
        cells = {}
        for c in row.findall(NS + 'c'):
            t = c.get('t')
            v = c.find(NS + 'v')
            isn = c.find(NS + 'is')
            if t == 's' and v is not None:
                try:
                    val = ss[int(v.text)]
                except Exception:
                    val = ''
            elif t == 'inlineStr' and isn is not None:
                val = ''.join(x.text or '' for x in isn.iter(NS + 't'))
            else:
                val = (v.text if v is not None else '')
            cells[colnum(c.get('r'))] = (val or '').strip()
        rows.append(cells)
    return rows


def load(src):
    z = zipfile.ZipFile(src)
    names = z.namelist()
    ss = []
    if 'xl/sharedStrings.xml' in names:
        r = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in r.findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid_target = {rel.get('Id'): rel.get('Target') for rel in rels}
    out = {}
    for s in wb.iter(NS + 'sheet'):
        name = s.get('name')
        tgt = rid_target.get(s.get(REL + 'id')) or ''
        if not tgt.startswith('xl/'):
            tgt = 'xl/' + tgt.lstrip('/')
        if tgt in names:
            out[name] = parse_sheet(z, tgt, ss)
    return out


def num(v):
    if v is None:
        return 0.0
    s = str(v).replace(',', '').replace('，', '').replace('%', '').replace(' ', '')
    if s in ('', '-', '—', '/', 'None'):
        return 0.0
    try:
        return float(s)
    except Exception:
        return 0.0


def excel_date(serial):
    try:
        n = int(float(serial))
    except Exception:
        return None
    if n < 20000 or n > 80000:
        return None
    return (date(1899, 12, 30) + timedelta(days=n)).isoformat()


def money(v):
    """金额格式化：保留两位，加千分位"""
    n = num(v)
    if n == 0 and str(v).strip() in ('', '0', '0.0'):
        return '0'
    return '{:,.2f}'.format(n)


def pct(v):
    """结算率统一成百分数（源表存的是 0.394 这类小数）"""
    n = num(v)
    if n == 0:
        return 0.0
    if n <= 1.5:
        n = n * 100
    return round(n, 2)


# ---------------------------------------------------------------------------
# 1) 汇总表：主播 × (当日GMV / 累计 / 30天预估结算 / 30天结算率)
# ---------------------------------------------------------------------------
def build_anchor_rank(rows):
    if not rows:
        return None
    # 表头两行合并
    main = rows[1] if len(rows) > 1 else {}
    sub = rows[2] if len(rows) > 2 else {}
    headers = ['']
    for c in range(1, 68):
        a = main.get(c, '')
        b = sub.get(c, '')
        if a and b and b not in a:
            headers.append(a + '·' + b)
        elif a:
            headers.append(a)
        elif b:
            headers.append(b)
        else:
            headers.append('列%d' % c)
    headers = headers[1:]

    # 数据截止日：优先用第1行隐藏的序列日期
    as_of = ''
    d = excel_date(rows[0].get(38, '')) if rows else None
    if d:
        as_of = d
    title = rows[0].get(1, '') if rows else ''

    data_rows = []
    for r in rows[3:]:
        org = r.get(1, '')
        name = r.get(2, '')
        if not name:
            continue
        if name in ('主播名', '合计', '总计', '汇总'):
            continue
        data_rows.append(r)

    raw_rows = []
    for r in data_rows:
        o = {}
        for i, h in enumerate(headers, start=1):
            o[h] = r.get(i, '')
        raw_rows.append(o)

    # 结构化行
    struct = []
    for r in data_rows:
        daily = [num(r.get(c, '')) for c in range(6, 36)]
        rate_daily = [pct(r.get(c, '')) for c in range(38, 68)]
        struct.append({
            'anchor': r.get(2, ''),
            'org': r.get(1, ''),
            'type': r.get(3, ''),
            'gmv': money(r.get(4, '')),
            'gmvCum': money(r.get(5, '')),
            'settleCum': money(r.get(36, '')),
            'rate': pct(r.get(37, '')),
            'daily': [round(x, 2) for x in daily],
            'rateDaily': rate_daily,
        })

    # 排名：按下播GMV累计降序
    order = sorted(range(len(struct)), key=lambda i: -(num(data_rows[i].get(5, '')) or num(data_rows[i].get(4, ''))))
    for rank, idx in enumerate(order, start=1):
        struct[idx]['rank'] = rank

    # 每日合计（1~30日）
    daily_total = []
    for i in range(30):
        s = sum(x['daily'][i] for x in struct)
        rs = [x['rateDaily'][i] for x in struct if x['rateDaily'][i]]
        daily_total.append({
            'day': '%d日' % (i + 1),
            'settle': round(s, 2),
            'rate': round(sum(rs) / len(rs), 2) if rs else 0
        })

    total_gmv = sum(num(r.get(4, '')) for r in data_rows)
    total_gmv_cum = sum(num(r.get(5, '')) for r in data_rows)
    total_settle = sum(num(r.get(36, '')) for r in data_rows)
    rates = [pct(r.get(37, '')) for r in data_rows if r.get(37, '') not in ('', None)]
    rates = [x for x in rates if x > 0]
    avg_rate = round(sum(rates) / len(rates), 2) if rates else 0

    # 复算整体结算率 = 预估结算累计 / 下播GMV累计
    calc_rate = round(total_settle / total_gmv_cum * 100, 2) if total_gmv_cum else 0

    return {
        'source': 'cloud',
        'asOf': as_of,
        'title': title,
        'rawHeaders': headers,
        'rawRows': raw_rows,
        'rows': struct,
        'daily': daily_total,
        'summary': {
            'anchors': len(struct),
            'gmvToday': round(total_gmv, 2),
            'gmvCum': round(total_gmv_cum, 2),
            'settleCum': round(total_settle, 2),
            'avgRate': avg_rate if avg_rate else calc_rate,
            'calcRate': calc_rate,
        },
    }


# ---------------------------------------------------------------------------
# 2) 每日明细表（1日 / 2日 sheet）
# ---------------------------------------------------------------------------
def build_daily_sheet(rows, sheet_name):
    if not rows or len(rows) < 3:
        return None
    main = rows[0]
    sub = rows[1]
    headers = ['']
    maxc = 0
    for r in rows[:3]:
        for k in r:
            maxc = max(maxc, k)
    for c in range(1, maxc + 1):
        a = main.get(c, '')
        b = sub.get(c, '')
        if a and b and b not in a:
            headers.append(a + '·' + b)
        elif a:
            headers.append(a)
        elif b:
            headers.append(b)
        else:
            headers.append('列%d' % c)
    headers = headers[1:]

    data = [r for r in rows[2:] if r.get(4, '') or r.get(2, '')]
    out = []
    for r in data:
        obj = {}
        for i, h in enumerate(headers, start=1):
            obj[h] = r.get(i, '')
        out.append(obj)
    return {
        'name': sheet_name,
        'date': excel_date(data[0].get(1, '')) if data else None,
        'headers': headers,
        'rows': out,
    }


# ---------------------------------------------------------------------------
# 3) 商品明细：数据来源 sheet → 类目聚合
# ---------------------------------------------------------------------------
def build_commodity(rows):
    if not rows or len(rows) < 2:
        return None
    hdr = rows[0]
    # 按表头名定位列
    idx = {}
    for c, v in hdr.items():
        if v:
            idx[v] = c

    def find(*keys):
        for k in keys:
            for name, c in idx.items():
                if k in name:
                    return c
        return None

    c_l1 = find('商品一级类目')
    c_l2 = find('商品二级类目')
    c_name = find('商品名称')
    c_seller = find('卖家昵称')
    c_op = find('卖家运营人员')
    c_pay = find('支付GMV')
    c_settle = find('风控后结算GMV(预估拼接)')
    c_settle2 = find('风控后结算GMV(元)')
    c_rate = find('结算率')
    c_day = find('时间')

    cats, prods, sellers, ops, days = {}, {}, {}, {}, {}
    total_pay = 0.0
    total_settle = 0.0
    n = 0
    for r in rows[1:]:
        pay = num(r.get(c_pay, '')) if c_pay else 0
        settle = num(r.get(c_settle, '')) if c_settle else 0
        if not settle and c_settle2:
            settle = num(r.get(c_settle2, ''))
        if not pay and not settle:
            continue
        n += 1
        total_pay += pay
        total_settle += settle
        l1 = r.get(c_l1, '') or '未分类'
        c = cats.setdefault(l1, {'name': l1, 'pay': 0.0, 'settle': 0.0, 'items': 0})
        c['pay'] += pay
        c['settle'] += settle
        c['items'] += 1
        pname = r.get(c_name, '')
        if pname:
            p = prods.setdefault(pname, {'name': pname, 'pay': 0.0, 'settle': 0.0, 'cat': l1, 'seller': r.get(c_seller, '')})
            p['pay'] += pay
            p['settle'] += settle
        sname = r.get(c_seller, '')
        if sname:
            s = sellers.setdefault(sname, {'name': sname, 'pay': 0.0, 'settle': 0.0, 'items': 0})
            s['pay'] += pay
            s['settle'] += settle
            s['items'] += 1
        oname = r.get(c_op, '')
        if oname:
            o = ops.setdefault(oname, {'name': oname, 'pay': 0.0, 'settle': 0.0, 'items': 0})
            o['pay'] += pay
            o['settle'] += settle
            o['items'] += 1
        dv = excel_date(r.get(c_day, '')) if c_day else None
        if dv:
            dd = days.setdefault(dv, {'date': dv, 'pay': 0.0, 'settle': 0.0, 'items': 0})
            dd['pay'] += pay
            dd['settle'] += settle
            dd['items'] += 1

    def top(d, k, limit):
        arr = sorted(d.values(), key=lambda x: -x[k])[:limit]
        for a in arr:
            a['pay'] = round(a['pay'], 2)
            a['settle'] = round(a['settle'], 2)
            a['rate'] = round(a['settle'] / a['pay'] * 100, 2) if a['pay'] else 0
        return arr

    return {
        'total': {
            'items': n,
            'pay': round(total_pay, 2),
            'settle': round(total_settle, 2),
            'rate': round(total_settle / total_pay * 100, 2) if total_pay else 0,
        },
        'categories': top(cats, 'settle', 20),
        'products': top(prods, 'settle', 50),
        'sellers': top(sellers, 'settle', 50),
        'operators': top(ops, 'settle', 20),
        'days': sorted(days.values(), key=lambda x: x['date']),
    }


def money_str(n):
    return '{:,.2f}'.format(n)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    data = load(src)
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print('sheets:', list(data.keys()))

    rank = build_anchor_rank(data.get('汇总', []))
    commodity = build_commodity(data.get('数据来源', []))

    # 每天一张的日快照：1日 / 2日 / 3日 …（自动识别，排除「4日 (2)」这类副本）
    daily_sheets = []
    for name, rows in data.items():
        if re.match(r'^\d+日$', name):
            s = build_daily_sheet(rows, name)
            if s and s['rows']:
                daily_sheets.append(s)
    daily_sheets.sort(key=lambda s: s.get('date') or '')

    if rank:
        s = rank['summary']
        print('主播数=%d  当日GMV=%s  累计GMV=%s  预估结算累计=%s  结算率=%s%%  截止=%s'
              % (s['anchors'], money_str(s['gmvToday']), money_str(s['gmvCum']),
                 money_str(s['settleCum']), s['avgRate'], rank['asOf']))
    if commodity:
        t = commodity['total']
        print('商品明细 %d 行  支付GMV=%s  结算GMV=%s  类目=%d  商品=%d  卖家=%d'
              % (t['items'], money_str(t['pay']), money_str(t['settle']),
                 len(commodity['categories']), len(commodity['products']), len(commodity['sellers'])))
    for s in daily_sheets:
        print('%s sheet 行数=%d 日期=%s' % (s['name'], len(s['rows']), s['date']))

    bundle = {
        'anchorRank': rank,
        'commodity': commodity,
        'dailies': daily_sheets,
        'generatedAt': None,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(bundle, f, ensure_ascii=False)
    import os
    print('写出 %s  %.1f KB' % (dst, os.path.getsize(dst) / 1024))


if __name__ == '__main__':
    main()
