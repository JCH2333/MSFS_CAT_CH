#!/usr/bin/env bash
# GSX 官方更新看门狗（部署在分发服务器，10 分钟一轮）
#
# 职责：通过 GitHub API 读取 FSDT 官方发布仓库
#       （virtualisoftware/fsdt-offline-installer）全部资产的 SHA-256 digest，
#       与"上次检测基线"比对，发现官方更新后通过 SMTP 发邮件提醒管理员。
#       只检测与通知，不下载负载、不改镜像数据；镜像同步由开发机
#       tools/gsx-mirror/auto-seed.mjs（15 分钟计划任务）自动执行，
#       同步完成另发「[GSX 自动同步]」确认邮件。
#
# 为什么用 API digest 而不是资产 ETag：国内服务器对
# objects.githubusercontent.com 的直连时通时断，逐资产 HEAD 不可靠；
# api.github.com 稳定可达，且一次调用即返回全部资产的 digest/updated_at。
#
# 部署布局（服务器 /home/admin/gsx-watch/）：
#   bin/watch.sh        本脚本
#   bin/send_mail.py    SMTP 邮件发送（仅用 python3 标准库）
#   etc/mail.ini        SMTP 凭据（管理员自行填写，勿提交仓库）
#   state/etags.state   上次检测基线（组件<TAB>digest<TAB>updated_at）
#   state/status.json   最近一次检测快照（官方 digest × 镜像同步状态）
#   state/mail-pending.txt  邮件未发出时暂存的通知内容，发出后清除
#   log/watch.log       运行日志（超过 5MB 自动清空）
#
# 定时：/etc/cron.d/gsx-watch，每 10 分钟（Asia/Shanghai）。
# 手动运行：bin/watch.sh [--dry-run]（--dry-run 只打印，不发送、不写状态）
#
# 判定规则：
#   - 某组件 digest != 基线 → 官方更新，纳入邮件；邮件发送成功才更新
#     基线，同一波次因此只提醒一次；发送失败下次运行自动重试。
#   - 已镜像组件在邮件中标注「自动同步进行中」；管理员只需处理汉化补丁适配。
set -u

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$BASE_DIR/state"
STATE_FILE="$STATE_DIR/etags.state"
PENDING_FILE="$STATE_DIR/mail-pending.txt"
LOG_FILE="$BASE_DIR/log/watch.log"
MAIL_INI="$BASE_DIR/etc/mail.ini"
SEND_MAIL="$BASE_DIR/bin/send_mail.py"
LOCK_DIR="$STATE_DIR/lock"

MANIFEST_URL="${GSX_MANIFEST_URL:-http://127.0.0.1:20075/api/gsx/manifest.json}"
RELEASE_API="https://api.github.com/repos/virtualisoftware/fsdt-offline-installer/releases/latest"

# 已镜像组件（与分发服务器镜像清单一致）；其余官方资产仅观察
MIRRORED="GSX GSX_sounds couatl couatl64 couatl64_wx couatl_wx fsdreamteam-gsx-pro-textures fsdreamteam-gsx-world-of-jetways-textures"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

mkdir -p "$STATE_DIR" "$BASE_DIR/log"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "[gsx-watch] 已有实例在运行，退出" >&2
    exit 1
fi
trap 'rm -rf "$LOCK_DIR"' EXIT

log() { echo "[$(date '+%F %T')] $*" >> "$LOG_FILE"; }
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    : > "$LOG_FILE"
fi

# 一次 API 调用拿全部资产：组件<TAB>sha256:<digest><TAB>updated_at
fetch_assets() {
    local json="" attempt
    for attempt in 1 2; do
        json=$(curl -s --max-time 30 \
            -H 'User-Agent: gsx-watch' -H 'Accept: application/vnd.github+json' \
            "$RELEASE_API" 2>/dev/null) && [ -n "$json" ] && break
        json=""
        sleep 10
    done
    [ -n "$json" ] || return 1
    printf '%s' "$json" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    assets = [(a.get("name", ""), a.get("digest", ""), a.get("updated_at", ""))
              for a in d.get("assets", [])]
    assets = [(n[:-len(".zip.001")], dg, ts) for n, dg, ts in assets
              if n.endswith(".zip.001") and dg]
    for name, dg, ts in sorted(assets):
        print("%s\t%s\t%s" % (name, dg, ts))
except Exception:
    sys.exit(1)
' || return 1
}

declare -A STATE_NEW DIGEST UPDATED
MANIFEST_JSON=$(curl -s --max-time 15 "$MANIFEST_URL" 2>/dev/null || true)
MANIFEST_SUMMARY="不可达"
if [ -n "$MANIFEST_JSON" ]; then
    MANIFEST_SUMMARY=$(printf '%s' "$MANIFEST_JSON" | python3 -c '
import json, sys
try:
    m = json.load(sys.stdin)
    print("%s（%d 个组件，更新于 %s）" % (m.get("latestVersion", "?"),
          len(m.get("packages", [])), m.get("updatedAt", "?")))
except Exception:
    pass
')
    [ -n "$MANIFEST_SUMMARY" ] || MANIFEST_SUMMARY="解析失败"
fi

if [ -f "$STATE_FILE" ]; then
    while IFS=$'\t' read -r c dg ts; do
        [ -n "$c" ] && STATE_NEW[$c]="$dg" && UPDATED[$c]="$ts"
    done < "$STATE_FILE"
fi

ASSETS_TSV=$(fetch_assets)
if [ -z "$ASSETS_TSV" ]; then
    log "ERROR: GitHub API 不可达或响应异常（重试后放弃），本次不更新基线"
    exit 1
fi

FIRST_RUN=0
[ -f "$STATE_FILE" ] || FIRST_RUN=1

CHANGES=()
COUNT=0
while IFS=$'\t' read -r c dg ts; do
    COUNT=$((COUNT + 1))
    DIGEST[$c]="$dg"
    UPDATED[$c]="$ts"
    old="${STATE_NEW[$c]:-}"
    if [ -n "$old" ] && [ "$old" != "$dg" ]; then
        CHANGES+=("$c|$old|$dg|$ts")
    fi
done <<< "$ASSETS_TSV"

write_state() {
    local tmp="$STATE_FILE.tmp"
    : > "$tmp"
    for c in "${!DIGEST[@]}"; do
        printf '%s\t%s\t%s\n' "$c" "${DIGEST[$c]}" "${UPDATED[$c]}" >> "$tmp"
    done
    sort -o "$tmp" "$tmp" && mv -f "$tmp" "$STATE_FILE"
}

write_status() {
    # 最近一次检测快照：官方 digest × 镜像 sha256 对账，供人工与管理端查看
    local assets_file="$STATE_DIR/assets.current.tsv"
    local manifest_file="$STATE_DIR/manifest.current.json"
    printf '%s\n' "$ASSETS_TSV" > "$assets_file"
    if [ -n "$MANIFEST_JSON" ]; then printf '%s' "$MANIFEST_JSON" > "$manifest_file"; else printf '{}' > "$manifest_file"; fi
    python3 -c '
import json, sys
state_dir, checked_at = sys.argv[1], sys.argv[2]
official = {}
for line in open(state_dir + "/assets.current.tsv"):
    parts = line.rstrip("\n").split("\t")
    if len(parts) >= 2 and parts[0]:
        official[parts[0]] = parts[1].replace("sha256:", "")
try:
    manifest = json.load(open(state_dir + "/manifest.current.json"))
    mirrored = {p.get("component"): (p.get("sha256") or "").lower().replace("sha256:", "")
                for p in manifest.get("packages", [])}
    latest = manifest.get("latestVersion")
except Exception:
    mirrored, latest = {}, None
status = {
    "checkedAt": checked_at,
    "mirrorLatestVersion": latest,
    "components": [
        {"name": name, "officialSha256": digest,
         "mirrored": name in mirrored,
         "inSync": mirrored.get(name) == digest}
        for name, digest in sorted(official.items())
    ],
}
json.dump(status, open(state_dir + "/status.json", "w"), ensure_ascii=False, indent=2)
' "$STATE_DIR" "$(date '+%F %T %Z')" >/dev/null 2>&1 || true
}

if [ "$DRY_RUN" -eq 1 ]; then
    write_status
    echo "资产总数: $COUNT（首次运行: $FIRST_RUN，镜像清单: $MANIFEST_SUMMARY）"
    if [ "${#CHANGES[@]}" -eq 0 ]; then
        echo "无官方更新（全部 digest 与基线一致）"
    else
        echo "发现 ${#CHANGES[@]} 个组件变化："
        printf '%s\n' "${CHANGES[@]}"
    fi
    exit 0
fi

if [ "${#CHANGES[@]}" -eq 0 ]; then
    write_state
    write_status
    rm -f "$PENDING_FILE"
    log "无官方更新（$COUNT 个资产一致）"
    exit 0
fi

# 组装邮件
SUBJECT="[GSX 更新看门狗] 发现官方更新（${#CHANGES[@]} 个组件变化）"
BODY_FILE="$STATE_DIR/notify-draft.txt"
{
    echo "检测时间: $(date '+%F %T %Z')"
    echo "官方发布仓库: virtualisoftware/fsdt-offline-installer（GitHub API 资产 digest 比对）"
    echo "镜像清单: latestVersion=$MANIFEST_SUMMARY"
    echo ""
    echo "以下官方资产的 SHA-256 相对上次检测发生变化："
    for row in "${CHANGES[@]}"; do
        IFS='|' read -r name old_dg new_dg ts <<< "$row"
        kind="未收录·仅观察"
        case " $MIRRORED " in *" $name "*) kind="已镜像（自动同步进行中）" ;; esac
        printf '  - %-48s [%s]\n      资产更新时间: %s\n      %s...\n      -> %s...\n' \
            "$name" "$kind" "$ts" "${old_dg#sha256:}" "${new_dg#sha256:}"
    done
    echo ""
    echo "后续流程（镜像同步全自动）："
    echo "  - 开发机自动种子器（15 分钟一轮）会把变更组件镜像到本服务器，"
    echo "    完成后另发「[GSX 自动同步] 官方更新已镜像」确认邮件；"
    echo "    镜像完成后客户端「GSX 更新」页即获得推送，无需人工操作。"
    echo ""
    echo "需要管理员处理的只剩汉化补丁适配（GSX 更新会覆盖补丁文件）："
    echo "  还原本机汉化补丁 → 更新 GSX → 比对文件 → 适配补丁 → 实机验证 → 发布新补丁"
    echo ""
    echo "每 10 分钟检测一次；同一波次变化只提醒一次。"
} > "$BODY_FILE"

python3 "$SEND_MAIL" "$SUBJECT" "$BODY_FILE"
SEND_RC=$?
if [ "$SEND_RC" -eq 0 ]; then
    write_state
    write_status
    rm -f "$PENDING_FILE"
    cp -f "$BODY_FILE" "$BASE_DIR/log/mail-$(date '+%Y%m%d-%H%M%S').txt" 2>/dev/null || true
    log "已发送通知邮件（${#CHANGES[@]} 个组件变化），基线已更新"
    exit 0
elif [ "$SEND_RC" -eq 78 ]; then
    cp -f "$BODY_FILE" "$PENDING_FILE"
    log "邮件未配置（etc/mail.ini 缺失或含占位符），待发通知已暂存 state/mail-pending.txt"
    exit 3
else
    cp -f "$BODY_FILE" "$PENDING_FILE"
    log "邮件发送失败（send_mail.py 退出码 $SEND_RC），下次运行将重试"
    exit 4
fi
