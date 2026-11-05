"""从金山文档(kdocs)拉取共享文件到本地。

原理：WPS 客户端已登录 kdocs，其内嵌浏览器(CEF)把登录 cookie
      加密存在本地。这里复用同一把密钥解开 wps_sid，再带它调
      kdocs 的文件下载接口，拿到带签名的 CDN 直链后流式下载。

用法：
    python scripts/kdocs_fetch.py --sid cpiiUJCyssoS
    python scripts/kdocs_fetch.py --fileid 569815449750 --out data/inbox

输出最后一行是 JSON，便于上层脚本解析。
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request

COOKIE_SRC = r"%APPDATA%\kingsoft\wps\addons\data\win-i386\cef_high\1.25\kcloudpage\cookies-v3\Network\Cookies"
PREFS = r"%APPDATA%\kingsoft\wps\addons\data\win-i386\LocalPrefs.json"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------- DPAPI / AES
class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi_unprotect(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    blob_in = DATA_BLOB(len(data), ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()
    if not crypt32.CryptUnprotectData(
        ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)
    ):
        raise OSError(ctypes.get_last_error(), "CryptUnprotectData 失败")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


def _cef_key() -> bytes:
    prefs = os.path.expandvars(PREFS)
    with open(prefs, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    raw = base64.b64decode(cfg["os_crypt"]["encrypted_key"])
    if raw[:5] != b"DPAPI":
        raise RuntimeError(" unexpected key prefix: %r" % raw[:5])
    return _dpapi_unprotect(raw[5:])


class _AUTHINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wt.ULONG),
        ("dwInfoVersion", wt.ULONG),
        ("pbNonce", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbNonce", wt.ULONG),
        ("pbAuthData", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbAuthData", wt.ULONG),
        ("pbTag", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbTag", wt.ULONG),
        ("pbMacContext", ctypes.POINTER(ctypes.c_ubyte)),
        ("cbMacContext", wt.ULONG),
        ("cbAAD", wt.ULONG),
        ("cbData", ctypes.c_ulonglong),
        ("dwFlags", wt.ULONG),
    ]


def _aes_gcm_decrypt(key: bytes, blob: bytes) -> str:
    if blob[:3] != b"v10":
        raise RuntimeError("不支持的 cookie 格式: %r" % blob[:3])
    nonce, body = blob[3:15], blob[15:]
    ciphertext, tag = body[:-16], body[-16:]

    bcrypt = ctypes.windll.bcrypt
    h_alg = ctypes.c_void_p()
    if bcrypt.BCryptOpenAlgorithmProvider(ctypes.byref(h_alg), "AES", None, 0) != 0:
        raise OSError("BCryptOpenAlgorithmProvider 失败")
    mode = "ChainingModeGCM".encode("utf-16-le") + b"\x00\x00"
    bcrypt.BCryptSetProperty(h_alg, "ChainingMode", mode, len(mode), 0)

    h_key = ctypes.c_void_p()
    if bcrypt.BCryptGenerateSymmetricKey(
        h_alg, ctypes.byref(h_key), None, 0, key, len(key), 0
    ) != 0:
        raise OSError("BCryptGenerateSymmetricKey 失败")

    nonce_buf = (ctypes.c_ubyte * len(nonce)).from_buffer_copy(nonce)
    tag_buf = (ctypes.c_ubyte * len(tag)).from_buffer_copy(tag)
    info = _AUTHINFO()
    info.cbSize = ctypes.sizeof(info)
    info.dwInfoVersion = 1
    info.pbNonce, info.cbNonce = nonce_buf, len(nonce)
    info.pbTag, info.cbTag = tag_buf, len(tag)

    out_len = wt.ULONG(0)
    bcrypt.BCryptDecrypt(
        h_key, ciphertext, len(ciphertext), ctypes.byref(info), None, 0, None, 0,
        ctypes.byref(out_len), 0,
    )
    out_buf = (ctypes.c_ubyte * out_len.value)()
    rc = bcrypt.BCryptDecrypt(
        h_key, ciphertext, len(ciphertext), ctypes.byref(info), None, 0,
        out_buf, out_len.value, ctypes.byref(out_len), 0,
    )
    if rc != 0:
        raise OSError(rc, "BCryptDecrypt 失败")
    return bytes(out_buf[: out_len.value]).decode("utf-8", "strict")


def get_wps_sid() -> str:
    """解开 WPS 内嵌浏览器的 wps_sid。"""
    src = os.path.expandvars(COOKIE_SRC)
    tmp = os.path.join(tempfile.gettempdir(), "kdocs_fetch_cookies.db")
    # 数据库被 WPS 独占，先复制一份快照
    shutil.copyfile(src, tmp)
    except_note = None
    key = _cef_key()
    con = sqlite3.connect(tmp)
    try:
        cur = con.execute(
            "select encrypted_value, value from cookies "
            "where name='wps_sid' and host_key like '%kdocs%' limit 1"
        )
        row = cur.fetchone()
    finally:
        con.close()

    try:
        os.remove(tmp)
    except OSError:
        pass

    if not row:
        raise RuntimeError("找不到 wps_sid，请确认 WPS 客户端已登录")
    enc, plain = row
    if plain:
        return plain
    if not enc:
        raise RuntimeError("wps_sid 为空")
    return _aes_gcm_decrypt(key, enc)


# ---------------------------------------------------------------- kdocs 接口
def _get(url: str, sid: str, referer: str | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", UA)
    req.add_header("Cookie", "wps_sid=%s" % sid)
    if referer:
        req.add_header("Referer", referer)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return json.loads(body.decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            return {"result": "http_error", "errno": e.code, "msg": e.reason}
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except Exception:  # noqa: BLE001
        return {"result": "bad_json", "raw": body[:200].decode("utf-8", "replace")}


def resolve_link(sid_code: str, wps_sid: str) -> dict:
    """把分享 sid 解析成 fileid / 文件名 / 大小。"""
    return _get(
        "https://drive.kdocs.cn/api/v5/links/%s" % sid_code,
        wps_sid,
        referer="https://www.kdocs.cn/l/%s" % sid_code,
    )


def request_download(fileid: str, wps_sid: str, referer: str) -> dict:
    return _get(
        "https://www.kdocs.cn/api/v3/office/file/%s/download?support_checksums=1" % fileid,
        wps_sid,
        referer=referer,
    )


def stream_download(url: str, dest: str, expect_size: int | None = None) -> dict:
    """流式下载，支持断点续传。"""
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    part = dest + ".part"
    start = os.path.getsize(part) if os.path.exists(part) else 0
    if expect_size and start >= expect_size:
        os.replace(part, dest)
        return {"ok": True, "bytes": start, "resumed": True}

    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", UA)
    if start:
        req.add_header("Range", "bytes=%d-" % start)

    written = start
    with urllib.request.urlopen(req, timeout=120) as resp, open(part, "ab") as f:
        total = resp.headers.get("Content-Length")
        if start and resp.status != 206:
            f.seek(0)
            f.truncate()
            written = 0
        chunk_size = 1 << 20
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            written += len(chunk)

    size_ok = True
    if expect_size:
        size_ok = written == expect_size
    if not size_ok:
        return {"ok": False, "bytes": written, "expected": expect_size, "reason": "size_mismatch"}

    os.replace(part, dest)
    return {"ok": True, "bytes": written}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", help="分享链接末尾的 sid，如 cpiiUJCyssoS")
    ap.add_argument("--fileid", help="直接指定 fileid")
    ap.add_argument("--out", default="data/inbox", help="保存目录")
    ap.add_argument("--name", help="覆盖保存的文件名")
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    args = ap.parse_args()

    result = {"ok": False, "step": "init"}
    try:
        wps_sid = get_wps_sid()
        result["step"] = "auth"

        meta = {}
        if args.sid:
            meta = resolve_link(args.sid, wps_sid)
            if meta.get("result") != "ok":
                result.update(error="链接解析失败", detail=meta)
                raise SystemExit(2)
            fileinfo = meta.get("fileinfo", {})
            fileid = str(fileinfo.get("id"))
            fname = fileinfo.get("fname") or "download.xlsx"
            fsize = fileinfo.get("fsize")
        elif args.fileid:
            fileid = args.fileid
            fname = args.name or ("%s.xlsx" % fileid)
            fsize = None
        else:
            result.update(error="必须指定 --sid 或 --fileid")
            raise SystemExit(2)

        result.update(fileid=fileid, name=fname, size=fsize, step="download_url")
        referer = "https://www.kdocs.cn/l/%s" % args.sid if args.sid else "https://www.kdocs.cn/"
        dl = request_download(fileid, wps_sid, referer)

        if dl.get("result") == "forbidProtectedFile":
            result.update(
                error="文件被所有者设为「禁止下载」",
                code="forbidProtectedFile",
                hint="需要在 WPS 里由文件所有者关闭下载保护，或把文件放进共享文件夹",
            )
            raise SystemExit(3)
        if not dl.get("download_url"):
            result.update(error="未取得下载直链", detail=dl)
            raise SystemExit(4)

        dest = os.path.join(args.out, args.name or fname)
        actual_size = dl.get("file_size") or fsize
        result["step"] = "transfer"
        got = stream_download(dl["download_url"], dest, actual_size)
        if not got.get("ok"):
            result.update(error="下载不完整", detail=got)
            raise SystemExit(5)

        result.update(ok=True, step="done", path=os.path.abspath(dest), bytes=got["bytes"])
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        result.update(error=str(e), detail=result.get("step"))
    finally:
        if args.json:
            print(json.dumps(result, ensure_ascii=False))
        elif result.get("ok"):
            print("OK  %s  (%s bytes)" % (result["path"], result["bytes"]))
        else:
            print("FAIL [%s] %s" % (result.get("step"), result.get("error")))
            if result.get("detail"):
                print("  ", result["detail"])

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
