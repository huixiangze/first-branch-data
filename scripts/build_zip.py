# -*- coding: utf-8 -*-
# 打包 CloudBase 部署用 zip（排除 ssl/bat/scripts/data-cache 等，包含 data/imports 导出目录）
import os, zipfile

ROOT = r'D:\小程序\第一分公司数据云台'
OUT = os.path.join(ROOT, '第一分公司数据云台-cloudbase.zip')

EXCLUDE_DIRS = {'ssl', 'scripts', 'node_modules', '.git', '__pycache__', 'data/cache', 'data\\cache'}
EXCLUDE_FILE_EXT = {'.zip', '.bat', '.exe'}
EXCLUDE_NAMES = {'第一分公司数据云台-cloudbase.zip', '第一分公司数据云台-deploy.zip'}

def excluded(rel):
    parts = rel.replace('\\', '/').split('/')
    # 排除特定目录
    for p in parts:
        if p in EXCLUDE_DIRS:
            return True
    base = parts[-1]
    if base in EXCLUDE_NAMES:
        return True
    _, ext = os.path.splitext(base)
    if ext.lower() in EXCLUDE_FILE_EXT:
        return True
    return False

def main():
    if os.path.exists(OUT):
        os.remove(OUT)
    count = 0
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            rel_dir = os.path.relpath(dirpath, ROOT)
            # 剪枝：跳过被排除的目录
            keep_dirs = []
            for d in dirnames:
                rd = os.path.join(rel_dir, d).replace('/', os.sep)
                if rd.replace('\\', '/') in EXCLUDE_DIRS or d in EXCLUDE_DIRS:
                    continue
                keep_dirs.append(d)
            dirnames[:] = keep_dirs
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ROOT)
                if excluded(rel):
                    continue
                arc = rel.replace('\\', '/')
                z.write(full, arc)
                count += 1
                print('+', arc)
    print('已生成:', OUT, os.path.getsize(OUT), 'bytes，共', count, '个文件')

if __name__ == '__main__':
    main()
