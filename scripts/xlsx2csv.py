#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一个多工作表的 xlsx 整本转成 CSV：每个工作表输出一个 .csv（UTF-8 BOM，Excel 直接打开不乱码）。

特点：
- 自动合并两行表头（如「预估结算GMV」+「1日/2日…」→「预估结算GMV·1日」）
- 自动跳过标题行（如「截止5号数据」）
- 数值保持原样，不做四舍五入，不改变数据

用法：
  python xlsx2csv.py <input.xlsx> [输出目录]
"""
import zipfile, xml.etree.ElementTree as ET, sys, os, re, csv, json

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


def colname(n):
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r'([A-Z]+)(\d+)', ref or '')
    if not m:
        return (0, 0)
    return (int(m.group(2)), colnum(m.group(1)))


def parse_sheet(z, path, ss):
    ws = ET.fromstring(z.read(path))
    rows_map = {}
    maxr = 0
    for row in ws.iter(NS + 'row'):
        ri = int(row.get('r') or (maxr + 1))
        if ri > maxr:
            maxr = ri
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
        rows_map[ri] = cells

    # 合并单元格：把左上角的值铺满整个区域，还原真实表头
    mc = ws.find(NS + 'mergeCells')
    if mc is not None:
        for m in mc.findall(NS + 'mergeCell'):
            ref = m.get('ref') or ''
            if ':' not in ref:
                continue
            a, b = ref.split(':', 1)
            r1, c1 = split_ref(a)
            r2, c2 = split_ref(b)
            if not r1 or not c1:
                continue
            val = rows_map.get(r1, {}).get(c1, '')
            if not val:
                continue
            if c2 - c1 > 400 or r2 - r1 > 400:
                continue
            for r in range(r1, r2 + 1):
                row = rows_map.setdefault(r, {})
                for c in range(c1, c2 + 1):
                    if not row.get(c):
                        row[c] = val
            if maxr < r2:
                maxr = r2

    return [rows_map.get(i, {}) for i in range(1, maxr + 1)]


def load_workbook(src):
    z = zipfile.ZipFile(src)
    names = z.namelist()
    ss = []
    if 'xl/sharedStrings.xml' in names:
        r = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in r.findall(NS + 'si'):
            ss.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rid = {rel.get('Id'): rel.get('Target') for rel in rels}
    out = []
    for s in wb.iter(NS + 'sheet'):
        name = s.get('name')
        tgt = rid.get(s.get(REL + 'id')) or ''
        if not tgt.startswith('xl/'):
            tgt = 'xl/' + tgt.lstrip('/')
        if tgt in names:
            out.append((name, parse_sheet(z, tgt, ss)))
    return out


def layout(name):
    """返回 (跳过行数, 表头行数)"""
    skip = 1 if name == '汇总' else 0
    two = (name == '汇总') or name.startswith('汇总数据') or bool(re.match(r'^\d+日', name))
    return skip, (2 if two else 1)


def build_table(rows, skip, hdr_n):
    body = rows[skip:]
    if not body:
        return [], []
    maxc = 0
    for r in body[:60]:
        for k in r:
            if k > maxc:
                maxc = k
    if maxc == 0:
        return [], [], 0

    h1 = body[0] if len(body) > 0 else {}
    h2 = body[1] if (hdr_n == 2 and len(body) > 1) else {}

    headers = []
    for c in range(1, maxc + 1):
        a = (h1.get(c, '') or '').strip()
        b = (h2.get(c, '') or '').strip()
        if hdr_n == 2 and b and b != a:
            name = (a + '·' + b) if a else b
        else:
            name = a or b
        if not name:
            name = '列' + str(c)
        headers.append(name)

    # 表头去重（真表里偶有同名空列）
    seen = {}
    for i, h in enumerate(headers):
        if h in seen:
            seen[h] += 1
            headers[i] = h + '_' + str(seen[h])
        else:
            seen[h] = 1

    data = []
    for r in body[hdr_n:]:
        line = [r.get(c, '') for c in range(1, maxc + 1)]
        if not any(x for x in line):
            continue
        data.append(line)

    # 丢掉"表头残留 + 整列无数据"的废弃列（原表里常有这类预留区块）
    counts = [0] * maxc
    for line in data:
        for i, v in enumerate(line):
            if v:
                counts[i] += 1
    keep = []
    for idx in range(maxc):
        c = idx + 1
        primary = bool((h1.get(c, '') or '').strip())
        if counts[idx] > 0 or primary:
            keep.append(idx)

    dropped = maxc - len(keep)
    headers = [headers[i] for i in keep]
    data = [[line[i] for i in keep] for line in data]
    return headers, data, dropped


def safe_name(n):
    n = re.sub(r'[\\/:*?"<>|]', '-', n)
    n = n.replace(' (', '-').replace(')', '')
    return n.strip() or 'sheet'


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if len(sys.argv) < 2:
        sys.exit('用法: python xlsx2csv.py <input.xlsx> [输出目录]')
    src = sys.argv[1]
    base = os.path.splitext(os.path.basename(src))[0]
    outdir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(os.path.abspath(src)), base + '_CSV')
    os.makedirs(outdir, exist_ok=True)

    sheets = load_workbook(src)
    print('工作簿：%s' % os.path.basename(src))
    print('工作表：%d 个' % len(sheets))
    print('输出目录：%s' % outdir)
    print('-' * 62)

    manifest = []
    for name, rows in sheets:
        skip, hdr_n = layout(name)
        headers, data, dropped = build_table(rows, skip, hdr_n)
        fn = safe_name(name) + '.csv'
        fp = os.path.join(outdir, fn)
        with open(fp, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f)
            if headers:
                w.writerow(headers)
            for line in data:
                w.writerow(line)
        size = os.path.getsize(fp)
        print('  %-12s %6d 行 × %3d 列   %7.1f KB   %s%s'
              % (name, len(data), len(headers), size / 1024, fn,
                 ('  (丢弃空列 %d)' % dropped) if dropped else ''))
        manifest.append({'sheet': name, 'file': fn, 'rows': len(data), 'cols': len(headers)})

    total = sum(os.path.getsize(os.path.join(outdir, m['file'])) for m in manifest)
    print('-' * 62)
    print('共 %d 个 CSV，合计 %.1f KB' % (len(manifest), total / 1024))

    with open(os.path.join(outdir, '_清单.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
