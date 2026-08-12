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
2. Commit and push the approved source changes to GitHub `main`; wait until the matching Gitee mirror branch reaches the same commit before creating a release tag or presenting the release as ready.
3. Build the final asset once, then record its exact filename, byte size, and SHA-256. Do not rebuild, rename, or overwrite that asset after either host has received it.
4. Treat repository mirroring and Release distribution as separate systems: GitHub-to-Gitee mirroring may copy commits, branches, and tags, but it does **not** copy Release records or Release attachments. Never assume that publishing a GitHub Release has published a Gitee Release.
5. For a **Patch Package**, use this mandatory order:
   1. Create the same release tag on the synchronized source.
   2. Create the Gitee Release first and upload the verified ZIP.
   3. Download the public Gitee asset and verify its SHA-256 and size match the prepared asset.
   4. Create the GitHub Release and upload the byte-identical ZIP.
   5. Verify the public GitHub asset name, size, and SHA-256.
   6. Only after both assets exist and match, update the Patch Catalog version, tag, filename, size, fingerprints, and SHA-256; commit and push that Catalog change, then wait for Gitee to mirror it.
6. For a **Software Release**, publish the GitHub workflow output and create the matching Gitee Release with byte-identical `latest.yml`, `MSFS_CAT_CH-Setup-<version>.exe`, and `.blockmap` assets. Verify Gitee can serve `latest.yml` from the tag download directory before treating the Gitee-first updater feed as ready.
7. If a Patch Catalog entry is pushed before its matching Release asset is publicly available, immediately restore that Catalog entry to the last verified package version. Do not leave clients pointing to a missing or unverified asset.
8. Confirm the client fallback order with real public URLs: Gitee first, GitHub second, and `ghfast.top` only after a GitHub timeout where supported.
9. Release automation may use a Gitee access token only through protected CI secrets. Never commit, print, export, or place the token in a workflow file, repository configuration, Release notes, or user-facing logs.
10. Report the exact version, tag, commit, asset names, checksums, and both public release locations. Never include credentials, tokens, local user paths, backups, or installation records.

## Agent Skills

### Issue Tracker

Tasks and PRDs live in GitHub Issues at `JCH2333/MSFS_CAT_CH`. See `docs/agents/issue-tracker.md`.

### Triage Labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain Docs

This repository uses a single project context at `CONTEXT.md` with architecture decisions under `docs/adr/`. See `docs/agents/domain.md`.
