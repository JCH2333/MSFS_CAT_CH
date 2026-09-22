# ADR 0007: GSX 官方更新自动镜像同步

日期：2026-09-23
状态：已接受

## 背景

ADR 0005 建立了 GSX 官方更新镜像：服务器看门狗（`tools/gsx-watch/`）每日一次
检测官方 GitHub Release 资产 digest 变化并发邮件，镜像同步由管理员在开发机手动
运行 `tools/gsx-mirror/seed.mjs`。两条断点使官方更新到客户端可见的延迟以"天"计：
检测频率低（每日一次）、同步纯手动；且 seed.mjs 的口令登录在 2.3.2 发布期实测失效
（服务端 seed 口令登不进 JCH2333）。目标：官方 GSX 发新版的典型同步延迟压到 1 小时内。

## 决策

1. **检测提频**：服务器看门狗 cron 从每日 09:10 改为每 10 分钟。判定逻辑不变
   （一次 api.github.com 调用取全部资产 SHA-256 digest 与基线比对），未认证限额
   60 次/时/IP 远未触顶。邮件语义升级：发现更新即提醒管理员，并注明镜像由
   开发机自动同步、管理员只需处理汉化补丁适配。
2. **同步自动化（开发机为主路径）**：新增 `tools/gsx-mirror/auto-seed.mjs` +
   `auto-seed.cmd`，Windows 计划任务 `GSX_AutoSeed` 每 15 分钟运行：
   官方 digest vs 服务器镜像 sha256 比对 → 漂移即自动运行 seed.mjs → 成功/失败邮件。
   - 检测主路径统一为 **API digest vs 镜像 sha256**（同一份字节，单分卷恒等），
     不再依赖资产 CDN 的 HEAD ETag；多分卷组件回退 seed 内的 etag 兜底判定。
   - 邮件复用服务器 gsx-watch 的 SMTP：正文 scp 上传后 ssh 调 `send_mail.py`，
     开发机不落 SMTP 凭据。失败告警按失败指纹去重（同一失败 6 小时内不重发）；
     连续 8 次（约 2 小时）无法读取官方 release（多为开发机代理掉线）告警一次。
   - 凭据：专用管理端账号 `gsx-mirror-bot`（isAdmin，仅自动化使用），口令保存在
     开发机 `.local-lab/gsx-autoseed-credentials.json`（gitignored，不入仓库/日志）。
     seed.mjs 同时支持 `GSX_ADMIN_TOKEN` 直通。
   - 路径全部基于脚本自身位置解析；`auto-seed.cmd` 内容保持纯 ASCII
     （cmd 按 ANSI 代码页解析批处理，UTF-8 中文注释会破坏解析）。
3. **服务器直下不做主路径**：资产 CDN 从阿里云时通时断，重试式直下只能作为
   未来开发机长期离线时的备选，暂不实现。
4. **全量安装包（storage/gsx-install/ 的 4.0.10 四件套）不随热更版本跟进**：
   设计上是底座，装完由热更差量自动追平；仅当差量过大时偶尔回种新底座。
   引导器 FSDT_Universal_Installer.exe 不在 GitHub 仓库内，以 release 中的
   Addon_Manager.exe digest 变化作为人工回种信号。
5. **版本号流转**（官方 4.0.23 → 4.0.24 时）：热更镜像 manifest 版本由 seed
   读包内 package_version 自动更新，客户端 GSX 页自动亮"更新可用"；install-manifest
   与客户端 App 版本不动；GSX 汉化补丁 addonVersion=null 全版本适配，官方更新覆盖
   补丁文件由客户端 pending 检测并提示重装，只有面板结构变化才需人工适配发新补丁。

## 后果

- 官方更新 → 服务器邮件（≤10 分钟）→ 镜像同步完成邮件（≤15 分钟）→ 客户端可见。
  全程无人值守；人工只剩补丁适配与（罕见）引导器回种。
- 开发机离线时同步停摆：看门狗邮件照发（标注自动同步进行中），开发机恢复后
  自动种子器下轮补齐并补发确认邮件。
- 新增运维资产：`gsx-mirror-bot` 账号、Windows 计划任务 `GSX_AutoSeed`、
  服务器 cron `*/10`、`state/status.json` 快照。
- 镜像红线不变：逐字节下载、服务端独立算 SHA-256、尊重 update.lock 熔断。

## 参考

0005-gsx-update-mirror.md
tools/gsx-watch/README.md
tools/gsx-mirror/seed.mjs / auto-seed.mjs
