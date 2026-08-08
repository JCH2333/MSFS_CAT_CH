# Patch Catalog v1

The live catalog is `manifest.json` on the `main` branch of `JCH2333/MSFS_CAT_CH_PATCHES`.

```json
{
  "schemaVersion": 1,
  "catalogVersion": "2026.08.06",
  "updatedAt": "2026-08-06T00:00:00Z",
  "patches": [
    {
      "id": "gsx-pro-zh-cn",
      "name": "GSX Pro 简体中文",
      "summary": "GSX Pro 界面与文本汉化",
      "version": "1.0.0",
      "addonVersion": "4.0.14",
      "status": "published",
      "compatibility": ["MSFS 2020", "MSFS 2024"],
      "targetHint": "请选择 GSX 安装目录",
      "targetFolders": ["fsdreamteam-gsx-pro"],
      "releaseNotes": ["首个 GitHub 发布版本"],
      "package": {
        "releaseTag": "gsx-pro-v1.0.0",
        "assetName": "gsx-pro-zh-cn-v1.0.0.zip",
        "sha256": "64-character lowercase SHA-256",
        "size": 0,
        "contentRoot": ""
      }
    }
  ]
}
```

`version` is the Patch Package version and `addonVersion` is the compatible add-on version; both use semantic versioning. `targetFolders` contains simple add-on directory names used only for local Steam and Microsoft Store target discovery. A user can override the discovered Installation Target in the desktop settings. `status` is one of `planned`, `published`, or `withdrawn`. Only `published` patches can be installed. ZIP paths are interpreted relative to the selected Installation Target. `contentRoot` optionally selects one directory inside the extracted archive.
