#!/usr/bin/env python3
# 零依赖：将 xlsx（或"伪 csv 实为 xlsx"）转换为真正的 UTF-8 CSV。
# 用法: python3 conv_xlsx.py <input.xlsx> <output.csv>
import zipfile, xml.etree.ElementTree as ET, csv, sys, re

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

def col_to_num(s):
    n = 0
    for ch in s:
        n = n * 26 + (ord(ch) - 64)
    return n

def num_to_col(n):
    s = ''
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def main():
    src, dst = sys.argv[1], sys.argv[2]
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
    sheet_file = None
    for s in wb.iter(NS + 'sheet'):
        rid = s.get(REL + 'id')
        tgt = rid_target.get(rid)
        if tgt:
            if not tgt.startswith('xl/'):
                tgt = 'xl/' + tgt.lstrip('/')
            sheet_file = tgt
            break
    if not sheet_file:
        cand = [n for n in names if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        sheet_file = sorted(cand)[0] if cand else None
    if not sheet_file:
        sys.exit('ERROR: 找不到 worksheet')
    ws = ET.fromstring(z.read(sheet_file))
    all_rows, maxc = [], 0
    for row in ws.iter(NS + 'row'):
        cells = {}
        for c in row.findall(NS + 'c'):
            ref = c.get('r') or ''
            m = re.match(r'[A-Z]+', ref)
            if not m:
                continue
            col = m.group()
            t = c.get('t')
            v = c.find(NS + 'v')
            isn = c.find(NS + 'is')
            if t == 's' and v is not None and v.text is not None:
                idx = int(v.text)
                val = ss[idx] if 0 <= idx < len(ss) else ''
            elif t == 'inlineStr' and isn is not None:
                val = ''.join(tt.text or '' for tt in isn.iter(NS + 't'))
            elif v is not None and v.text is not None:
                val = v.text
            else:
                val = ''
            cells[col] = val
            maxc = max(maxc, col_to_num(col))
        all_rows.append(cells)
    rows_out = [[cells.get(num_to_col(i), '') for i in range(1, maxc + 1)] for cells in all_rows]
    with open(dst, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        for r in rows_out:
            w.writerow(r)
    ncol = len(rows_out[0]) if rows_out else 0
    print('OK sheet=%s rows=%d cols=%d -> %s' % (sheet_file, len(rows_out), ncol, dst))

if __name__ == '__main__':
    main()
