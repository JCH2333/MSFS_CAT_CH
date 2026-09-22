# GSX 官方更新看门狗（服务器端定时检测 + 邮件通知）

部署在分发服务器（47.109.31.236）`/home/admin/gsx-watch/`，每 10 分钟由
`/etc/cron.d/gsx-watch` 运行一次。检测 FSDT 官方 GitHub 发布资产
（`virtualisoftware/fsdt-offline-installer`）的 SHA-256 digest 变化，发现更新即发邮件提醒管理员。

设计要点（与 `docs/adr/0005-gsx-update-mirror.md`、`docs/adr/0007-gsx-auto-mirror-sync.md` 及
`.local-lab/notes.md` 的结论一致）：

- **API digest 是权威的新版本信号**——一次 `api.github.com` 调用即返回全部资产的
  SHA-256，不依赖时通时断的资产 CDN（官方更新器用的 ETag 信号由 seed 侧兜底）。
- **只检测与通知，不搬运负载**。镜像同步由开发机 `tools/gsx-mirror/auto-seed.mjs`
  （15 分钟计划任务）自动执行：漂移检测 → `seed.mjs` 逐字节下载上传 → 结果邮件。
- 邮件发送成功才更新检测基线（`state/etags.state`），同一波次只提醒一次；发送失败下次运行自动重试。
- 已镜像的 8 个组件在邮件中标注「自动同步进行中」，其余官方资产标注「未收录·仅观察」。
  管理员唯一需要人工处理的是汉化补丁适配（GSX 更新会覆盖补丁文件）。
- 每次运行写 `state/status.json`（官方 digest × 镜像 sha256 对账 + inSync 标记），
  供人工检查与管理端后续展示。
- SMTP 凭据在服务器 `etc/mail.ini` 由管理员自行填写（参考 `mail.ini.example`），绝不提交仓库或出现在聊天里。
  开发机自动种子器的邮件也复用这份配置（scp 正文 + ssh 调 `send_mail.py`，本机不落 SMTP 凭据）。

## 文件

| 文件 | 说明 |
| --- | --- |
| `watch.sh` | 检测与通知编排（bash + curl + python3，服务器零额外依赖） |
| `send_mail.py` | SMTP 发送（python3 标准库，465 SSL / 587 STARTTLS） |
| `mail.ini.example` | SMTP 配置模板 |

## 常用操作（服务器上）

```bash
# 手动检测一次（不发送、不写基线；但会刷新 status.json）
~/gsx-watch/bin/watch.sh --dry-run

# 发送测试邮件（需先配置 etc/mail.ini）
~/gsx-watch/bin/send_mail.py --test

# 查看检测快照、日志与待发通知
cat ~/gsx-watch/state/status.json
tail -20 ~/gsx-watch/log/watch.log
cat ~/gsx-watch/state/mail-pending.txt
```

## 部署（从开发机）

```bash
ssh admin@47.109.31.236 'mkdir -p ~/gsx-watch/{bin,etc,state,log}'
scp tools/gsx-watch/watch.sh tools/gsx-watch/send_mail.py \
    admin@47.109.31.236:gsx-watch/bin/
scp tools/gsx-watch/mail.ini.example admin@47.109.31.236:gsx-watch/etc/
ssh admin@47.109.31.236 'chmod +x ~/gsx-watch/bin/*.sh ~/gsx-watch/bin/*.py'
```

定时任务（`/etc/cron.d/gsx-watch`，root 安装）：

```
SHELL=/bin/bash
PATH=/usr/bin:/bin
*/10 * * * * admin /home/admin/gsx-watch/bin/watch.sh >> /home/admin/gsx-watch/log/cron.log 2>&1
```
