# Project Instructions

## Read First

Before changing the project, read:

- `CONTEXT.md` for the domain model and current system shape.
- Relevant decisions under `docs/adr/`.
- `docs/patch-catalog.md` when changing patch discovery, packaging, installation, or restoration.

Use the domain terms from `CONTEXT.md` consistently in code, tests, documentation, and issues.

## Product Boundary

This repository contains a Windows Electron application for installing and managing GSX Chinese localization patches.

- GitHub is the only remote service.
- Software releases come from `JCH2333/gsx-chinese-tool` GitHub Releases.
- The Patch Catalog and Patch Package releases come from `JCH2333/gsx-chinese-patches`.
- Do not add a custom server, login, activation, database, Redis, WebSocket, telemetry, feedback upload, queue, or watermark system.
- Keep catalog caching so local operations remain available during temporary GitHub outages.
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

- The public `main` branch must have clean history containing only the GitHub-based application.
- Keep `legacy/server-backed` local. Never push that branch or any commit containing old server code or secrets.
- Do not force-push, publish a release, or create tags unless the user explicitly requests it.
- Tags matching `v*` trigger the Windows release workflow.
- Do not publish a Patch Catalog entry until its release asset exists and its SHA-256 value has been verified.

## Agent Skills

### Issue Tracker

Tasks and PRDs live in GitHub Issues at `JCH2333/gsx-chinese-tool`. See `docs/agents/issue-tracker.md`.

### Triage Labels

Use `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain Docs

This repository uses a single project context at `CONTEXT.md` with architecture decisions under `docs/adr/`. See `docs/agents/domain.md`.
