# GSX 镜像自动种子器（服务器自治版）

部署在分发服务器（47.109.31.236）`/home/admin/gsx-auto-seed/`，每 15 分钟由
`/etc/cron.d/gsx-auto-seed` 运行一次。检测官方 GitHub Release 资产 digest 与本机
镜像 sha256 的漂移，有漂移即断点续传下载官方资产、校验后经本地回环登记发布——
**全链路不依赖开发机**（开发机离线/代理关闭均不影响）。

与 `gsx-watch`（每 10 分钟检测+邮件提醒）的关系：watch 只检测与通知；本组件
负责搬运负载。两者邮件都走 `gsx-watch/etc/mail.ini` 的 SMTP。

## 容错设计

- **断点续传**：`.part` 断点跨周期保留，229MB 级大文件可分多轮接力（CDN 时通时断的对策）。
- **兜底通道**：直连连续失败后尝试 `ghfast.top` 前缀（可在 config.ini 关闭）。
- **邮件节流**：每波成功一封确认邮件；连续 8 个周期（≈2 小时）无法完成才告警一封。
- **官方熔断**：`update.virtualisoftware.com/update.lock` 存在时跳过本轮。
- **发布语义**：同组件重新发布会自动下线旧行（服务端保证），并复核文件 SHA-256。

## 部署（从开发机）

```bash
ssh admin@47.109.31.236 'mkdir -p ~/gsx-auto-seed/{bin,etc,state/parts,log}'
scp tools/gsx-auto-seed/bin/auto-seed.py admin@47.109.31.236:gsx-auto-seed/bin/
scp tools/gsx-auto-seed/etc/*.example admin@47.109.31.236:gsx-auto-seed/etc/
scp tools/gsx-auto-seed/cron.gsx-auto-seed admin@47.109.31.236:/tmp/
# 服务器上：填 credentials.ini（镜像库管理员账号）、装 cron
ssh admin@47.109.31.236 '
  cd ~/gsx-auto-seed/etc && cp config.ini.example config.ini && cp credentials.ini.example credentials.ini
  chmod 600 credentials.ini
  sudo cp /tmp/cron.gsx-auto-seed /etc/cron.d/gsx-auto-seed && sudo chmod 644 /etc/cron.d/gsx-auto-seed
'
```

## 常用操作（服务器上）

```bash
# 手动跑一轮（不做任何变更，仅检测与下载验证）
~/gsx-auto-seed/bin/auto-seed.py --dry-run

# 强制全链路同步单个组件（即使无漂移，用于演练；同字节重发布服务端会自动下线旧行）
~/gsx-auto-seed/bin/auto-seed.py --force-component fsdreamteam-gsx-world-of-jetways-textures

# 查看状态与日志
cat ~/gsx-auto-seed/state/state.json
tail -30 ~/gsx-auto-seed/log/auto-seed.log
```

## 凭据

`etc/credentials.ini`（600）存镜像库管理员账号（gsx-mirror-bot），仅供本机回环
调用登记/发布接口；勿提交仓库或出现在聊天中。SMTP 凭据复用 `gsx-watch/etc/mail.ini`。
