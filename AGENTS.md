# Project Instructions

## Read First

Before changing the project, read:

- `CONTEXT.md` for the domain model and current system shape.
- Relevant decisions under `docs/adr/`.
- `docs/patch-catalog.md` when changing patch discovery, packaging, installation, or restoration.

Use the domain terms from `CONTEXT.md` consistently in code, tests, documentation, and issues.

## Product Boundary

This repository contains a Windows Electron application for installing and managing Microsoft Flight Simulator add-on Chinese localization patches.

- Public Gitee is the primary distribution service. Public GitHub is the fallback service; `ghfast.top` is used only after a GitHub timeout where the client supports it.
- Software releases use Gitee `ljd123456/MSFS_CAT_CH` first and `JCH2333/MSFS_CAT_CH` GitHub Releases second.
- The Patch Catalog and Patch Package releases use Gitee `ljd123456/MSFS_CAT_CH_PATCHES` first and `JCH2333/MSFS_CAT_CH_PATCHES` second.
- Do not add a custom server, login, activation, database, Redis, WebSocket, telemetry, feedback upload, queue, or watermark system.
- Keep catalog caching so local operations remain available during temporary distribution-host outages.
- Development of the newest localization content is tracked separately in GitHub issue `#1` and is deferred until network access permits it.

## Source Map

- `electron/main.js`: Electron lifecycle, IPC registration, window creation, and software updates.
- `electron/preload.js`: narrow renderer-to-main bridge exposed through `contextBridge`.
- `electron/github-catalog.js`: Patch Catalog fetching, caching, validation, and release URL handling.
- `electron/patch-installer.js`: package download, checksum verification, safe extraction, backup, installation records, verification, and restore.
- `src/`: Vue renderer and desktop interface.
- `tests/`: Node tests for catalog and installer behavior.
- `.github/workflows/release.yml`: tagged Windows release workflow.

Keep filesystem and network privileges in Electron's main process. Do not expose raw Node.js, Electron, filesystem, or shell APIs to the renderer.

## Patch Safety Rules

Treat downloaded Patch Packages and catalog data as untrusted input.

- Require a valid SHA-256 checksum before installation.
- Reject absolute paths, path traversal, symbolic links, and duplicate patch IDs.
- Ensure every extracted path remains below the user-selected Installation Target.
- Back up replaced files before writing new content.
- Write an Installation Record only for a completed installation.
- Restore original files from backup.
- Remove introduced files during restore only when they still match the installed hash; preserve files modified by the user.
- Do not weaken these rules without an explicit architecture decision and regression tests.

## Change Discipline

- Prefer existing Vue, Electron, and Node patterns over new dependencies or abstractions.
- Keep changes scoped; do not restore or retain legacy server/admin code.
- Never commit credentials, tokens, local environment files, build output, caches, logs, downloaded patches, backups, or installation records.
- Preserve the compact desktop-tool UI and its existing responsive behavior.
- Add or update focused tests when behavior changes, especially for download validation and filesystem operations.

## Verification

Run these checks before handing off code changes:

```powershell
npm test
npm run build
node --check electron/main.js
node --check electron/preload.js
node --check electron/github-catalog.js
node --check electron/patch-installer.js
```

For interface changes, also inspect desktop and narrow layouts and check the browser/Electron console for errors. For packaging or update changes, run `npm run dist:win` when the environment permits it.

## Git And Releases

- The public `main` branch must have clean history containing only the desktop application and its GitHub/Gitee distribution configuration.
- Keep `legacy/server-backed` local. Never push that branch or any commit containing old server code or secrets.
- Do not force-push, publish a release, or create tags unless the user explicitly requests it.
- Tags matching `v*` trigger the Windows release workflow.
- Do not publish a Patch Catalog entry until its release asset exists and its SHA-256 value has been verified.

### Future Release Checklist

Do not create a Release merely because source code has changed. Only perform the following after the user explicitly authorizes a Software Release or Patch Package release.

1. Run the required tests, build, and Windows package checks from **Verification**.
2. Commit and push the approved source changes to GitHub `main`; wait until both Gitee pull mirrors contain the same commit before presenting the release as ready.
3. Create the GitHub tag and GitHub Release. The software workflow publishes `latest.yml`, the Windows installer, and its `.blockmap` asset; Patch Package releases publish the verified ZIP asset.
4. Create the corresponding Gitee Release with the same tag and upload byte-identical release assets. Gitee mirroring copies commits, branches, and tags, but it does **not** copy Release attachments.
5. For a Software Release, upload `latest.yml`, `MSFS_CAT_CH-Setup-<version>.exe`, and its `.blockmap` to the Gitee Release. Verify Gitee can serve `latest.yml` from the tag download directory so the client can use Gitee as its primary updater feed.
6. For a Patch Package release, upload the verified ZIP to the Gitee Release first, then verify its SHA-256 remains identical to the Patch Catalog value. Only then publish the associated Patch Catalog entry.
7. Confirm the client fallback order with real public URLs: Gitee first, GitHub second, and `ghfast.top` only after a GitHub timeout where supported.
8. Report the exact version, tag, commit, asset names, checksums, and both public release locations. Never include credentials, tokens, local user paths, backups, or installation records.

## Agent Skills

### Issue Tracker

Tasks and PRDs live in GitHub Issues at `JCH2333/MSFS_CAT_CH`. See `docs/agents/issue-tracker.md`.

### Triage Labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain Docs

This repository uses a single project context at `CONTEXT.md` with architecture decisions under `docs/adr/`. See `docs/agents/domain.md`.
