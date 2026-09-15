# ADR 0005: GSX 官方更新镜像（国内下载加速）

日期：2026-09-16
状态：已接受

## 背景

GSX Pro 的官方更新负载由 FSDreamTeam 发布在其 GitHub Release
（`virtualisoftware/fsdt-offline-installer`，就地更新的公开 ZIP 资产），官方更新器
（couatl64_boot.exe / Couatl_Updater2.exe）从 GitHub 下载后按固定映射部署。中国大陆
用户普遍无法稳定访问 GitHub，导致 GSX 长期无法更新。EULA 原文未公开，但官方同时提供
Offline Installer 与 MD5 校验仓库，国内社区"正版分流"镜像已有多年的公开先例。

## 决策

1. **镜像姿态**：分发服务器托管官方公开 ZIP 的逐字节副本（禁止重打包），上传时服务端
   计算 SHA-256，发布时复核；界面声明仅供已购买正版的用户使用；管理端可随时下架，
   下架后公开清单立即为空（客户端 stale 缓存仅用于展示，不用于下载）。
2. **客户端复刻"下载+部署"**：官方更新器地址硬编码、不可重定向，因此由客户端从自建
   服务器下载后按官方同款映射部署（couatl 侧热更包 → Addon Manager 子目录；
   `fsdreamteam-gsx-*-textures` → 对应社区包根，其内嵌 manifest 即版本改写机制）。
   官方部署为纯同路径文件替换，无 layout.json 处理。
3. **差量判定**：组件待更新 = 镜像清单 ETag ≠ 本地应用状态 ETag 且 ≠ 官方 sidecar
   ETag（`%APPDATA%\Virtuali\PackagesCache\github-etags`）。应用成功后同步写官方
   sidecar，避免可直连 GitHub 的用户被官方更新器重复下载。
4. **安全模型与补丁一致**：镜像内容按不可信输入处理（SHA-256 校验、防越界解压、
   拒绝符号链接、备份被覆盖文件、失败回滚、状态落盘）；更新前校验模拟器与 couatl
   引擎进程已退出。
5. **范围**：一期仅做"已安装用户的版本更新"；从 0 全新安装（需镜像多 GB 完整包）与
   激活辅助（协议未公开，不做协议复刻）暂缓，另行立项。

## 后果

- 中国用户无需访问 GitHub/FSDT 即可完成 GSX 版本更新；官方激活/校验机制完全不被触碰。
- GSX 官方更新会覆盖汉化补丁文件（FSDT_GSX_Panel.* 在 pro-textures 包内），客户端在
  更新前后就补丁状态给出明确提示；新版本补丁由 gsx-patch-update 流程适配。
- 镜像目标仅收录部署目标已实证的组件（8 个）；其余规则/贴图包待官方实测后再加入。
- 种子流程（tools/gsx-mirror/seed.mjs）在开发机带代理执行，尊重官方 update.lock 熔断。

## 参考

- 实验记录与官方部署映射：本地 `.local-lab/notes.md`（不入库）
- 服务端模块：`MSFS_CAT_CH_SERVER` 仓库 `GsxMirror*`（commit 77ad6b1）
