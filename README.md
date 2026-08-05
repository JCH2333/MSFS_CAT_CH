# GSX 汉化工具

Windows 桌面汉化补丁管理工具。软件和补丁均通过 GitHub 发布，不需要自建服务器、账号或激活。

## 开发

```powershell
npm install
npm run dev
```

## 验证

```powershell
npm test
npm run build
```

## 发布

推送 `v*` 标签后，GitHub Actions 构建 Windows 安装包并发布到 GitHub Releases。补丁发布规范见 `docs/patch-catalog.md`。
