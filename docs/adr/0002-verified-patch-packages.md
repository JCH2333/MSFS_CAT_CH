# ADR-0002: Verified ZIP patch packages

## Status

Accepted

## Context

Patch installation modifies simulator add-on files. A failed or malicious package must not escape the chosen directory or make restoration impossible.

## Decision

Each published patch points to one ZIP release asset and a required SHA-256 checksum. Electron downloads and verifies the archive, rejects unsafe paths and symbolic links, backs up existing files, then copies package files below the selected Installation Target.

Installation Records live under Electron user data. Restore only removes an introduced file when its current hash still matches the installed hash; modified files are reported as conflicts instead of being deleted.

## Consequences

- Patch publishing must calculate SHA-256 after the final ZIP is built.
- A user chooses the Installation Target until a future patch-specific locator is proven reliable.
- Interrupted installation can roll back from the same backup set.
