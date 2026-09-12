# Patch Catalog v1

The live catalog is `manifest.json` on the `main` branch of `JCH2333/MSFS_CAT_CH_PATCHES`.

Distribution host transition (ADR-0004): client 1.4 keeps reading this Gitee-hosted catalog; client 2.0 reads the catalog from the Distribution Server at `GET /api/catalog/manifest.json` (same schema below) and the Gitee/GitHub hosts stop being used. The schema, SHA-256 verification, and stale-cache rules are identical on both hosts; `package.giteeParts` exists only for Gitee-era packages and is never produced for server-hosted packages.

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
      "fingerprint": [
        { "relativePath": "html_ui/InGamePanels/FSDT_GSX_Panel/FSDT_GSX_Panel.js", "sha256": "64-character lowercase SHA-256" }
      ],
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

`version` is the Patch Package version and `addonVersion` is the compatible add-on version; both use semantic versioning. `targetFolders` contains simple add-on directory names used only for local Steam and Microsoft Store target discovery. `fingerprint` is an optional list of all Patch Package output files and their SHA-256 values. The application uses it only to recognize a complete pre-existing patch without downloading or modifying files; every relative path is validated before use. A user can override the discovered Installation Target in the desktop settings. `status` is one of `planned`, `published`, or `withdrawn`. Only `published` patches can be installed. ZIP paths are interpreted relative to the selected Installation Target. `contentRoot` optionally selects one directory inside the extracted archive.

For a Patch Package whose complete ZIP exceeds Gitee's release-attachment limit, `package.giteeParts` may contain an ordered list of `{ assetName, sha256, size }` records. The desktop application downloads and verifies each Gitee part, concatenates them into the original ZIP, and verifies the complete ZIP SHA-256 before extraction. The original `assetName`, `size`, and `sha256` remain mandatory for the byte-identical GitHub fallback. The sum of all Gitee part sizes must exactly match `package.size`.

GSX total patches use `targetKind: "gsx-combined"` and a two-entry `package.installPlan`: `primary` selects the user-approved Community add-on target, while `gsx-runtime-res` is resolved only by Electron from the installed FSDreamTeam Addon Manager directory. Their ZIP content roots are separate (normally `community` and `runtime-res`). A fingerprint may include `target`; omitted targets mean `primary`. The installer backs up every replacement file in both targets before writing, records each file's target path and hash, and restores both the panel text files and native button images only when they still match the installed hashes.
