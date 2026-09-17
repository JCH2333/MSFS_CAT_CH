# GSX 官方更新看门狗（服务器端定时检测 + 邮件通知）

部署在分发服务器（47.109.31.236）`/home/admin/gsx-watch/`，每日 09:10（Asia/Shanghai）由
`/etc/cron.d/gsx-watch` 运行一次。检测 FSDT 官方 GitHub 发布资产
（`virtualisoftware/fsdt-offline-installer`）的 ETag 变化，发现更新即发邮件提醒管理员。

设计要点（与 `docs/adr/0005-gsx-update-mirror.md` 及 `.local-lab/notes.md` 的结论一致）：

- **ETag 是权威的新版本信号**——官方更新器本身就用它，且比官网 changelog 页可靠（页面经常滞后十余个版本，且 403 反爬）。
- **只检测与通知，不搬运负载**。镜像种子仍由开发机 `tools/gsx-mirror/seed.mjs` 执行（逐字节下载 → SHA-256 → 管理端 API 发布）。
- 邮件发送成功才更新检测基线（`state/etags.state`），同一波次只提醒一次；发送失败下次运行自动重试。
- 已镜像的 8 个组件在邮件中标注「已镜像」，其余官方资产标注「未收录·仅观察」。
- SMTP 凭据在服务器 `etc/mail.ini` 由管理员自行填写（参考 `mail.ini.example`），绝不提交仓库或出现在聊天里。

## 文件

| 文件 | 说明 |
| --- | --- |
| `watch.sh` | 检测与通知编排（bash + curl + python3，服务器零额外依赖） |
| `send_mail.py` | SMTP 发送（python3 标准库，465 SSL / 587 STARTTLS） |
| `mail.ini.example` | SMTP 配置模板 |

## 常用操作（服务器上）

```bash
# 手动检测一次（不发送、不写基线）
~/gsx-watch/bin/watch.sh --dry-run

# 发送测试邮件（需先配置 etc/mail.ini）
~/gsx-watch/bin/send_mail.py --test

# 查看日志与待发通知
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
10 9 * * * admin /home/admin/gsx-watch/bin/watch.sh >> /home/admin/gsx-watch/log/cron.log 2>&1
```
