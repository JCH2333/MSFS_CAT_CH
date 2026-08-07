# Project Context

## Purpose

MSFS_CAT_CH is a Windows desktop application that installs, updates, verifies, and restores Chinese localization patches for Microsoft Flight Simulator add-ons without a custom server or user account.

## Domain Glossary

### Software Release

An installable desktop application version published in `JCH2333/MSFS_CAT_CH` GitHub Releases. Avoid: OTA record, app package stored by our server.

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

## System Shape

- Vue renders the local desktop interface.
- Electron owns filesystem, download, verification, backup, install, restore, and software-update operations.
- GitHub is the only network dependency.
- The application remains usable with cached Patch Catalog data when GitHub is temporarily unavailable.
- There is no login, activation, telemetry, feedback upload, queue, watermark, database, Redis, WebSocket, or custom server.
