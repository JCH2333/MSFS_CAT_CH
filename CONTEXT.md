# Project Context

## Purpose

MSFS_CAT_CH is a Windows desktop application that installs, updates, verifies, and restores Chinese localization patches for Microsoft Flight Simulator add-ons without a custom server or user account.

## Domain Glossary

### Software Release

An installable desktop application version published to the matching Gitee and GitHub Releases. The client checks the Gitee release first and falls back to GitHub. Avoid: OTA record, app package stored by our server.

### Patch Catalog

The versioned `manifest.json` in `JCH2333/MSFS_CAT_CH_PATCHES`. It is the only remote index the desktop application reads to discover patches. Avoid: patch database, patch list endpoint.

### Patch Package

A ZIP asset attached to a `JCH2333/MSFS_CAT_CH_PATCHES` GitHub Release. It contains only files that should be copied below an Installation Target. Every published package has a SHA-256 checksum in the Patch Catalog.

### Installation Target

The local directory selected by the user for one patch. All extracted files must remain below this directory. Avoid: server patch path.

### Installation Record

Local metadata stored under Electron user data. It records the patch version, Installation Target, installed file hashes, and backups required for restoration.

### Restore

The local operation that reinstates original files from an Installation Record and removes files introduced by a Patch Package when they have not been modified afterward.

### Distribution Server

The self-hosted Alibaba Cloud server that serves the software update feed, the Patch Catalog, and Patch Package downloads. Its code lives in the separate `MSFS_CAT_CH_SERVER` repository. Avoid: cloud platform, third-party host.

### Feedback Submission

An anonymous, user-initiated report (text plus optional screenshot) sent to the Distribution Server and visible in its admin frontend. It collects no personal data and is rate limited per IP. Avoid: telemetry, usage tracking.

## System Shape

- Vue renders the local desktop interface.
- Electron owns filesystem, download, verification, backup, install, restore, and software-update operations.
- The Distribution Server is the primary source for the software update feed, the Patch Catalog, and Patch Package downloads. During the transition (client 1.4) the server feed is checked first and public Gitee stays the release/publish path with GitHub second and `ghfast.top` as a GitHub-timeout fallback; from client 2.0 the server is the only distribution source and the legacy hosts are removed.
- Software updates resolve the Distribution Server's `electron-updater` generic feed (each Gitee-era Software Release keeps `latest.yml`, the installer, and its `.blockmap` asset for the transition).
- The application remains usable with cached Patch Catalog data when the Distribution Server is temporarily unavailable.
- There is no login, activation, telemetry, watermark, queue, or custom account system on the client; feedback submission is anonymous.
