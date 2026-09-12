# ADR-0004: Self-hosted server distribution

## Status

Accepted (supersedes ADR-0003 for new releases; Gitee/GitHub remain the release path only for the 1.4 bridge version)

## Context

Gitee-first distribution requires every release to be manually published on two hosts with byte-identical assets, imposes Gitee release-attachment size limits (forcing `giteeParts` split packages), and depends on third-party host availability. A low-cost Alibaba Cloud mainland server (2C2G / 200M bandwidth / 40G disk) is available, and the project already operated a self-hosted distribution server in the legacy `server-backed` snapshot (`MSFS_P_CH` Spring Boot server + `msfs-web-admin` Electron admin, extracted to the separate `MSFS_CAT_CH_SERVER` repository). The owner also plans a personal website on the same server (deferred; domain + ICP filing prepared first).

## Decision

1. Move all distribution (software update feed, Patch Catalog, Patch Package downloads) to the self-hosted server. Gitee/GitHub/`ghfast.top` client code is removed in the 2.0 client; the 1.4 bridge client only adds a server-first software-update check while keeping Gitee/GitHub patch downloads and release publishing unchanged.
2. The client keeps its entire trust model: SHA-256 verification of every package against the Patch Catalog, fingerprint recognition, backup, restore, and stale local catalog caching. The server is a file host plus catalog publisher, never a trust anchor.
3. Player-facing accounts, activation codes, the WebSocket download queue, friend invitations, and per-user watermarking (incompatible with anonymous downloads) are removed from the legacy server. Only the administrator authenticates (JWT). Downloads and feedback are anonymous.
4. Feedback submission (text + optional screenshot, anonymous, IP rate-limited, size/type validated) replaces the "no feedback upload" boundary rule; it is user-initiated only and collects no personal data.
5. Per-user watermark tracing is replaced by a per-release batch identifier (build-id embedded in the package and linked to download records) plus published SHA-256 values for authenticity checks.
6. The server exposes `GET /api/catalog/manifest.json` in the existing Patch Catalog v1 schema so client catalog parsing is unchanged except for the source URL and `source: 'server'` label.

## Transition

1. Buy the domain and submit ICP filing now (about 2–3 weeks); the website itself is deferred.
2. Release 1.4 through the existing Gitee/GitHub flow with forced update: UI and patch downloads unchanged; adds server-first update check (inert until the server feed URL constant is filled).
3. After filing is granted, publish 2.0 only on the server; forced update moves clients over. Gitee/GitHub releases then stop and their client code is gone.

## Consequences

- Release publishing becomes: build once → upload through the admin frontend → verify the public asset SHA-256 → publish the catalog. No Gitee manual gate.
- The server is a single point of distribution after 2.0; stale-cache behavior and the forced-update flow mitigate outages. Weekly backups of the storage directory and MySQL are required.
- `AGENTS.md`, `CONTEXT.md`, and `docs/patch-catalog.md` are updated to describe the server-first boundary and this two-step transition.
