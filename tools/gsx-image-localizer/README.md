# GSX 图片汉化制作工具

这是给补丁制作者使用的本地工具，用于处理 GSX 的原生弹窗图片。它只会处理 `couatl/GSX/res` 下的按钮与帮助图资源；不会修改 `.pye`、`couatl64_MSFS2024.exe`、`bglmanx65.dll`、`.fssync-checksum.json`、机场配置或任何用户数据。

## 安全流程

1. 先建立原始文件备份，并逐个重新校验哈希。
2. 生成结果只写入 `tools/gsx-image-localizer/output/`。
3. 再校验输出文件。
4. 游戏、Couatl 和官方更新器均关闭后，才可显式安装。
5. 恢复只覆盖仍与本工具安装版本一致的文件；用户后续修改过的文件会保留并记为冲突。

同一 GSX 版本的备份只有在完整、哈希一致且当前原始文件也一致时才复用。检测到同版本原始文件变化时，工具会保留旧备份并创建带时间戳的新快照，绝不覆盖或删除旧备份。

## 命令

在项目根目录运行：

```powershell
$py = 'E:\python\3.12\python.exe'
& $py tools\gsx-image-localizer\gsx_image_localizer.py scan
& $py tools\gsx-image-localizer\gsx_image_localizer.py backup
& $py tools\gsx-image-localizer\gsx_image_localizer.py verify-backup
& $py tools\gsx-image-localizer\gsx_image_localizer.py build
& $py tools\gsx-image-localizer\gsx_image_localizer.py verify-output
& $py tools\gsx-image-localizer\gsx_image_localizer.py install
& $py tools\gsx-image-localizer\gsx_image_localizer.py restore
```

默认运行时目录为 `F:\games\MSF tools\Addon Manager\couatl\GSX\res`。原始备份保存到 `.local-backups\gsx-runtime\<GSX版本>\`，其中有 `backup-manifest.json`、原始文件与安装/恢复记录。

## 翻译

按钮优先使用 `glossary.json` 的固定术语。未命中的文字可选用 Codex：

```powershell
$env:OPENAI_API_KEY = '仅在当前 PowerShell 会话设置'
& $py tools\gsx-image-localizer\gsx_image_localizer.py --with-gpt build
```

密钥不会写入项目、缓存或用户目录。GPT 仅返回结构化译文，图片由本地程序清除英文并重绘。翻译缓存仅写入被 Git 忽略的 `cache/`。

帮助图需要本地 Tesseract OCR 才进入处理流程；在没有可靠 OCR 或未完成人工版面复核时，工具会安全跳过帮助图，仅产出通过质量门槛的按钮图片。
