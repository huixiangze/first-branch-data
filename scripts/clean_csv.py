#!/usr/bin/env python3
# 清洗 anchorRank.csv：去掉报表标题行 + 合并双表头 + 删除纯空列
import csv
base = r'D:/小程序/第一分公司数据云台'
p = base + r'/data/imports/anchorRank.csv'
rows = list(csv.reader(open(p, encoding='utf-8')))
# rows[0]=报表标题(弃) rows[1]=主表头 rows[2]=子表头 rows[3:]=数据
main, sub = rows[1], rows[2]
data = [r for r in rows[3:] if any((c or '').strip() for c in r)]
ncol = len(main)
keep = []
for i in range(ncol):
    a = (main[i] if i < len(main) else '').strip()
    b = (sub[i] if i < len(sub) else '').strip()
    name = a
    if b and b != a:
        name = (a + '·' + b) if a else b
    col = [(r[i] if i < len(r) else '') for r in data]
    if name == '' and all((c or '').strip() == '' for c in col):
        continue
    if name == '':
        name = '列%d' % (i + 1)
    keep.append((i, name))
out = [[n for _, n in keep]]
for r in data:
    out.append([(r[i] if i < len(r) else '') for i, _ in keep])
with open(p, 'w', encoding='utf-8', newline='') as f:
    csv.writer(f).writerows(out)
print('清洗完成: 保留列=%d 数据行=%d' % (len(keep), len(data)))
