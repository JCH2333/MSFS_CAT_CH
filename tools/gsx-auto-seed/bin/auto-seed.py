#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GSX 镜像自动种子器（服务器自治版，部署在分发服务器 ~/gsx-auto-seed/）。

职责：检测官方 GitHub Release 资产 digest 与本机镜像 sha256 的漂移，有漂移即
断点续传下载官方资产（直连失败多轮后尝试 ghfast.top 兜底）、校验、经本地回环
上传到镜像库并发布，结果邮件走 gsx-watch 的 SMTP（本机调用，无需跳板）。

设计要点：
- 不依赖开发机：检测（gsx-watch）→ 下载 → 上传 → 邮件全在本机闭环。
- 资产 CDN 时通时断：.part 断点跨周期保留（每 15 分钟一轮接力），极端情况
  单个大文件滞后数小时，但不需要任何人工介入。
- 凭据：etc/credentials.ini（600，勿入库）。update.lock 存在时尊重官方熔断。

用法：bin/auto-seed.py [--dry-run] [--force-component NAME]
定时：/etc/cron.d/gsx-auto-seed，每 15 分钟（对齐 gsx-watch 的部署方式）。
"""

import base64
import configparser
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_DIR = os.path.join(BASE_DIR, "state")
PARTS_DIR = os.path.join(STATE_DIR, "parts")
LOG_FILE = os.path.join(BASE_DIR, "log", "auto-seed.log")
LOCK_DIR = os.path.join(STATE_DIR, "lock")
CREDENTIALS_FILE = os.path.join(BASE_DIR, "etc", "credentials.ini")
SEND_MAIL = os.path.expanduser("~/gsx-watch/bin/send_mail.py")

ORIGIN = "http://127.0.0.1:20075"
RELEASE_API = "https://api.github.com/repos/virtualisoftware/fsdt-offline-installer/releases/latest"
DOWNLOAD_BASE = "https://github.com/virtualisoftware/fsdt-offline-installer/releases/latest/download"
FALLBACK_PREFIX = "https://ghfast.top/"
UPDATE_LOCK_URL = "http://update.virtualisoftware.com/update.lock"

MIRRORED = [
    ("GSX", "couatl/GSX"),
    ("GSX_sounds", "couatl/GSX/sounds"),
    ("couatl", "couatl"),
    ("couatl64", "couatl64"),
    ("couatl64_wx", "couatl64/wx"),
    ("couatl_wx", "couatl/wx"),
    ("fsdreamteam-gsx-pro-textures", "MSFS/fsdreamteam-gsx-pro"),
    ("fsdreamteam-gsx-world-of-jetways-textures", "MSFS/fsdreamteam-gsx-world-of-jetways"),
]

FAILURE_ALERT_THRESHOLD = 8       # 连续失败周期数（15 分钟一轮 ≈ 2 小时）
INNER_RETRIES = 2                 # 单周期内每个下载通道的重试次数
CURL_MAX_TIME = 1800              # 单次 curl 最长时间（断点续传可跨周期接力）
CURL_CONNECT_TIMEOUT = 20

DRY_RUN = "--dry-run" in sys.argv
FORCE_COMPONENT = None
if "--force-component" in sys.argv:
    FORCE_COMPONENT = sys.argv[sys.argv.index("--force-component") + 1]


def log(message):
    line = "[auto-seed] " + time.strftime("%F %T") + " " + message
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        if os.path.getsize(LOG_FILE) > 5 * 1024 * 1024:
            os.truncate(LOG_FILE, 0)
    except OSError:
        pass


def http_get(url, timeout=30, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": "gsx-auto-seed", **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def load_config():
    config = configparser.ConfigParser()
    config.read(os.path.join(BASE_DIR, "etc", "config.ini"))
    return {
        "origin": config.get("server", "origin", fallback=ORIGIN).rstrip("/"),
        "release_api": config.get("github", "release_api", fallback=RELEASE_API),
        "download_base": config.get("github", "download_base", fallback=DOWNLOAD_BASE),
        "fallback_prefix": config.get("github", "fallback_prefix", fallback=FALLBACK_PREFIX),
        "use_fallback": config.getboolean("github", "use_fallback", fallback=True),
        "failure_alert_threshold": config.getint("seed", "failure_alert_threshold", fallback=FAILURE_ALERT_THRESHOLD),
    }


def load_credentials():
    config = configparser.ConfigParser()
    config.read(CREDENTIALS_FILE)
    return config.get("mirror", "username"), config.get("mirror", "password")


def curl(args):
    """执行 curl，返回 (returncode, stdout_bytes, stderr_text)。"""
    result = subprocess.run(["curl", "-sS", "--connect-timeout", str(CURL_CONNECT_TIMEOUT),
                             "--max-time", str(CURL_MAX_TIME)] + args,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.returncode, result.stdout, result.stderr.decode("utf-8", "replace")


def fetch_release(settings):
    raw = http_get(settings["release_api"], headers={"Accept": "application/vnd.github+json"})
    release = json.loads(raw)
    assets = {}
    for asset in release.get("assets", []):
        match = re.fullmatch(r"(.+)\.zip\.(\d{3})", asset.get("name", ""))
        if not match:
            continue
        name = match.group(1)
        entry = assets.setdefault(name, {"digest": None, "volumes": 0, "size": 0})
        entry["volumes"] = max(entry["volumes"], int(match.group(2)))
        if asset.get("digest"):
            entry["digest"] = asset["digest"].split("sha256:")[-1].lower()
        entry["size"] += int(asset.get("size", 0))
    return release.get("tag_name", "?"), assets


def fetch_mirror_digests(origin):
    with urllib.request.urlopen(origin + "/api/gsx/manifest.json", timeout=15) as response:
        manifest = json.loads(response.read())
    digests = {}
    for package in manifest.get("packages", []):
        digests[package.get("component")] = str(package.get("sha256", "")).lower().replace("sha256:", "")
    return digests


def check_update_lock():
    try:
        with urllib.request.urlopen(UPDATE_LOCK_URL, timeout=5) as response:
            body = response.read(200).decode("utf-8", "replace")
            raise SystemExit("[auto-seed] 官方 update.lock 生效，FSDT 已暂停更新通道：" + body)
    except urllib.error.HTTPError as error:
        if error.code == 200:
            raise
    except urllib.error.URLError:
        log("update.lock 探测不可达（视为未锁定，与官方口径一致）")
    except TimeoutError:
        log("update.lock 探测超时（视为未锁定）")


def download_component(name, size, digest, settings):
    """断点续传下载单组件到 parts/<name>.zip.part；完成后校验大小与 sha256。"""
    part_path = os.path.join(PARTS_DIR, name + ".zip.part")
    direct_url = settings["download_base"] + "/" + name + ".zip.001"
    channels = [direct_url]
    if settings["use_fallback"] and settings["fallback_prefix"]:
        channels.append(settings["fallback_prefix"] + direct_url)

    for round_index in range(INNER_RETRIES + 1):
        for channel_index, channel in enumerate(channels):
            # -L 必需：github.com/.../latest/download 是 302 跳转到资产 CDN
            args = ["-L", "-C", "-", "-o", part_path, "--retry", "1"]
            code, _, stderr = curl(args + [channel])
            if code != 0:
                log("  %s: 通道 %d 下载失败（curl=%d %s）" % (name, channel_index, code, stderr.strip()[:120]))
                continue
            stat = os.stat(part_path)
            if stat.st_size == 0:
                log("  %s: 通道 %d 返回空文件，删除重试" % (name, channel_index))
                os.remove(part_path)
                continue
            if stat.st_size == size:
                sha = hashlib.sha256()
                with open(part_path, "rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        sha.update(chunk)
                if sha.hexdigest() == digest:
                    return part_path
                log("  %s: sha256 不匹配（服务器 CDN 内容异常），删除重下" % name)
                os.remove(part_path)
                continue
            if stat.st_size > size:
                log("  %s: .part 超过预期大小，删除重下" % name)
                os.remove(part_path)
            else:
                log("  %s: .part %d/%d 字节（保留断点，下轮接力）" % (name, stat.st_size, size))
    raise RuntimeError("组件 %s 下载未能在本周期完成（保留断点，下轮接力）" % name)


def read_embedded_version(path):
    """社区包 zip 头部 512KB 内含 manifest.json 的 package_version；couatl 侧返回 None。"""
    with open(path, "rb") as handle:
        head = handle.read(512 * 1024)
    match = re.search(rb'"package_version"\s*:\s*"([0-9.]+)"', head)
    return match.group(1).decode() if match else None


def fetch_etag(name, settings):
    code, out, _ = curl(["-I", settings["download_base"] + "/" + name + ".zip.001"])
    if code == 0:
        for line in out.decode("utf-8", "replace").splitlines():
            if line.lower().startswith("etag:"):
                return line.split(":", 1)[1].strip().strip('"')
    return ""


def mirror_login(settings):
    username, password = load_credentials()
    request = urllib.request.Request(
        settings["origin"] + "/api/auth/login",
        data=json.dumps({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.loads(response.read())
    token = (body.get("data") or {}).get("accessToken")
    if not token:
        raise RuntimeError("镜像库管理员登录失败")
    return token


def upload_and_publish(token, name, target, version, etag, part_path, settings):
    upload = subprocess.run(["curl", "-sS", "--max-time", "600",
                             "-H", "Authorization: Bearer " + token,
                             "-F", "file=@" + part_path + ";filename=" + name + ".zip",
                             "-F", "component=" + name,
                             "-F", "version=" + version,
                             "-F", "etag=" + etag,
                             "-F", "deployTarget=" + target,
                             "-F", "assetName=" + name + ".zip",
                             settings["origin"] + "/api/admin/gsx/packages"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if upload.returncode != 0:
        raise RuntimeError("上传 curl 失败：%s" % upload.stderr.decode("utf-8", "replace")[:150])
    body = json.loads(upload.stdout)
    if body.get("code") != 200:
        raise RuntimeError("登记失败：%s" % body.get("message"))
    package_id = (body.get("data") or {}).get("id")
    if not package_id:
        raise RuntimeError("登记响应缺少包 id")
    publish = urllib.request.Request(
        settings["origin"] + "/api/admin/gsx/packages/%s/publish" % package_id,
        data=b"", headers={"Authorization": "Bearer " + token}, method="POST")
    with urllib.request.urlopen(publish, timeout=60) as response:
        publish_body = json.loads(response.read())
    if publish_body.get("code") != 200:
        raise RuntimeError("发布失败：%s" % publish_body.get("message"))


def send_mail(subject, body):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as handle:
        handle.write(body)
        body_path = handle.name
    try:
        subprocess.run(["python3", SEND_MAIL, subject.replace('"', ""), body_path], check=True)
        log("邮件已发送：" + subject)
    finally:
        os.unlink(body_path)


def load_state():
    state_path = os.path.join(STATE_DIR, "state.json")
    try:
        with open(state_path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_state(state):
    with open(os.path.join(STATE_DIR, "state.json"), "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2)


def main():
    settings = load_config()

    os.makedirs(STATE_DIR, exist_ok=True)
    os.makedirs(PARTS_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    try:
        os.mkdir(LOCK_DIR)
    except FileExistsError:
        log("已有实例在运行，退出")
        return 0
    try:
        return run(settings)
    finally:
        os.rmdir(LOCK_DIR)


def run(settings):
    state = load_state()
    check_update_lock()

    try:
        tag, assets = fetch_release(settings)
    except Exception as error:
        state["github_failures"] = state.get("github_failures", 0) + 1
        save_state(state)
        log("官方 release 获取失败（连续第 %d 次）：%s" % (state["github_failures"], error))
        if state["github_failures"] == settings["failure_alert_threshold"]:
            try:
                send_mail("[GSX 自动同步] 官方更新检测持续失败",
                          "连续 %d 个周期无法读取 GitHub 官方 release，镜像同步停摆。\n"
                          "时间：%s" % (state["github_failures"], time.strftime("%F %T")))
            except Exception as mail_error:
                log("告警邮件失败：%s" % mail_error)
        return 1
    if state.get("github_failures"):
        state["github_failures"] = 0
        save_state(state)
    log("官方 latest release：%s（%d 个分卷组件）" % (tag, len(assets)))

    digests = fetch_mirror_digests(settings["origin"])

    drifted = []
    for name, _target in MIRRORED:
        asset = assets.get(name)
        if FORCE_COMPONENT and name == FORCE_COMPONENT:
            drifted.append(name)
            continue
        if not asset or not asset["digest"] or asset["volumes"] != 1:
            continue  # 多分卷/缺资产：本轮忽略（与开发机种子器口径一致）
        if digests.get(name) != asset["digest"]:
            drifted.append(name)

    if not drifted:
        log("无漂移（官方 %s，镜像一致）" % tag)
        if state.pop("last_fail_key", None) is not None:
            save_state(state)
        return 0

    log("检测到漂移：%s" % ", ".join(drifted))
    if DRY_RUN:
        log("dry-run：仅下载验证，不上传（--force-component 可强制全链路）")
        for name in drifted:
            asset = assets.get(name) or {}
            if asset.get("digest"):
                try:
                    download_component(name, asset["size"], asset["digest"], settings)
                    log("  %s：下载+校验 OK（dry-run 不上传）" % name)
                    os.remove(os.path.join(PARTS_DIR, name + ".zip.part"))
                except Exception as error:
                    log("  %s：%s" % (name, error))
        return 0

    token = mirror_login(settings)
    published_versions = {}
    try:
        with urllib.request.urlopen(settings["origin"] + "/api/gsx/manifest.json", timeout=15) as response:
            for package in json.loads(response.read()).get("packages", []):
                published_versions[package.get("component")] = package.get("version")
    except Exception:
        pass
    completed = []
    failed = []
    for name in drifted:
        target = dict(MIRRORED)[name]
        asset = assets.get(name) or {}
        try:
            part_path = download_component(name, asset["size"], asset["digest"], settings)
            version = read_embedded_version(part_path) or published_versions.get(name)
            if not version:
                raise RuntimeError("无法确定版本（组件内无 manifest.json，且服务器无既有版本）")
            etag = fetch_etag(name, settings) or (asset.get("digest") or "")
            upload_and_publish(token, name, target, version, etag, part_path, settings)
            completed.append("%s v%s" % (name, version))
            os.remove(part_path)
        except Exception as error:
            failed.append("%s: %s" % (name, error))
            log("  %s 同步失败：%s" % (name, error))

    if not failed:
        # 全部成功且镜像已追平 → 每波发一封确认邮件
        after = fetch_mirror_digests(settings["origin"])
        still_drifted = [name for name in drifted
                         if assets.get(name, {}).get("digest") and after.get(name) != assets[name]["digest"]]
        if not still_drifted and state.get("last_success_wave") != tag:
            state["last_success_wave"] = tag
            save_state(state)
            try:
                send_mail("[GSX 自动同步] 官方更新已镜像，请跑补丁适配流程",
                          "官方 release %s 的更新已自动同步到分发服务器。\n\n"
                          "同步组件：%s\n"
                          "同步复核：全部一致 ✓\n时间：%s\n\n"
                          "提醒：GSX 更新会覆盖汉化补丁文件（FSDT_GSX_Panel.* 在 pro-textures 包内），\n"
                          "客户端会提示受影响用户重装补丁；请按补丁适配流程实机验证汉化是否完好。\n"
                          % (tag, ", ".join(completed), time.strftime("%F %T")))
            except Exception as mail_error:
                log("成功邮件失败（同步已完成）：%s" % mail_error)
        log("RESULT: 同步完成：%s" % ", ".join(completed))
        return 0

    state["last_fail_key"] = tag + "|" + "|".join(sorted(failed))
    save_state(state)
    try:
        send_mail("[GSX 自动同步] 部分组件同步失败",
                  "官方 release：%s\n成功：%s\n失败：%s\n时间：%s\n\n"
                  "失败的组件将在下轮自动重试（断点续传）；持续失败请人工排查。"
                  % (tag, ", ".join(completed) or "无", "；".join(failed), time.strftime("%F %T")))
    except Exception as mail_error:
        log("失败邮件失败：%s" % mail_error)
    return 1


if __name__ == "__main__":
    sys.exit(main() or 0)
