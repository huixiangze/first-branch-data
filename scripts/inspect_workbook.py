#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
大体积 xlsx 结构速览（流式解析，不整表进内存）

用途：1GB 级的「业绩预估表」这类工作簿，先用它看清有哪些 sheet、
每个 sheet 多少行、表头长什么样，再决定怎么入库。

用法：
    python scripts/inspect_workbook.py "D:\\path\\to\\book.xlsx"
    python scripts/inspect_workbook.py book.xlsx --max-rows 300000 --sample 5
"""
import sys
import re
import zipfile
import argparse
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/package/2006/relationships}'


def col_to_num(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    if not m:
        return 0
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n


def num_to_col(n):
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def read_shared_strings(z, cap=3_000_000):
    if 'xl/sharedStrings.xml' not in z.namelist():
        return [], False
    out = []
    truncated = False
    with z.open('xl/sharedStrings.xml') as f:
        for _ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == NS + 'si':
                out.append(''.join(t.text or '' for t in el.iter(NS + 't')))
                el.clear()
                if len(out) >= cap:
                    truncated = True
                    break
    return out, truncated


def sheet_map(z):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rmap = {}
    for r in rels.findall(RNS + 'Relationship'):
        rmap[r.get('Id')] = r.get('Target')
    out = []
    for s in wb.iter(NS + 'sheet'):
        rid = s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        tgt = rmap.get(rid, '')
        if tgt and not tgt.startswith('/'):
            tgt = 'xl/' + tgt.lstrip('./')
        out.append({'name': s.get('name'), 'path': tgt})
    return out


def scan_sheet(z, path, ss, max_rows, sample, ss_truncated):
    first = []
    width = 0
    count = 0
    header_rows = []
    with z.open(path) as f:
        for _ev, el in ET.iterparse(f, events=('end',)):
            if el.tag != NS + 'row':
                continue
            count += 1
            if len(first) < sample:
                cells = {}
                for c in el.findall(NS + 'c'):
                    t = c.get('t')
                    v = c.find(NS + 'v')
                    isn = c.find(NS + 'is')
                    if t == 's' and v is not None:
                        try:
                            idx = int(v.text)
                            val = ss[idx] if idx < len(ss) else ('<ss#%d>' % idx)
                        except Exception:
                            val = ''
                    elif t == 'inlineStr' and isn is not None:
                        val = ''.join(x.text or '' for x in isn.iter(NS + 't'))
                    else:
                        val = (v.text if v is not None else '')
                    val = (val or '').strip()
                    if val:
                        cells[col_to_num(c.get('r'))] = val
                if cells:
                    width = max(width, max(cells))
                    header_rows.append(cells)
            el.clear()
            if count >= max_rows:
                break
    return {'rows': count, 'width': width, 'sample': header_rows, 'truncated': count >= max_rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--max-rows', type=int, default=300000)
    ap.add_argument('--sample', type=int, default=4)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    z = zipfile.ZipFile(a.file)
    ss, truncated = read_shared_strings(z)
    print('共享字符串 %d 条%s' % (len(ss), '（已截断）' if truncated else ''))

    sheets = sheet_map(z)
    print('工作表 %d 个\n' % len(sheets))
    for s in sheets:
        if not s['path'] or s['path'] not in z.namelist():
            print('=== %s  <找不到 XML: %s>' % (s['name'], s['path']))
            continue
        info = scan_sheet(z, s['path'], ss, a.max_rows, a.sample, truncated)
        flag = '  (扫描到上限，行数可能更多)' if info['truncated'] else ''
        print('=== %s  行数=%d  列数=%d%s' % (s['name'], info['rows'], info['width'], flag))
        for i, row in enumerate(info['sample']):
            items = [(num_to_col(k), v) for k, v in sorted(row.items())][:14]
            print('  r%d: %s' % (i + 1, ' | '.join('%s=%s' % (k, v) for k, v in items)))
        print()


if __name__ == '__main__':
    main()
