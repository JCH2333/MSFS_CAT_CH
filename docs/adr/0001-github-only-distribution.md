# ADR-0001: GitHub-only distribution

## Status

Accepted

## Context

The previous system required a Spring server, MySQL, Redis, email, authentication, queue processing, and an administration client. The desktop tool only needs trusted release metadata and downloadable files.

## Decision

Use two public GitHub repositories:

- `JCH2333/MSFS_CAT_CH` for source code and Software Releases.
- `JCH2333/MSFS_CAT_CH_PATCHES` for the Patch Catalog and Patch Package releases.

The desktop application accesses GitHub without embedded credentials. Cached catalog data provides read-only fallback during temporary network failures.

## Consequences

- The custom server, administration client, accounts, queues, telemetry, and remote watermark features are deleted.
- Public GitHub rate limits apply, but catalog refreshes are infrequent and do not require the GitHub REST interface for package downloads.
- Software and patch release lifecycles remain independent.
