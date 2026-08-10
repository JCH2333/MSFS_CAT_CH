# ADR-0003: Gitee-primary public distribution

## Status

Accepted

## Decision

Use public Gitee repositories as the primary source for the Patch Catalog and Patch Package release URLs. Use the existing public GitHub repositories as the second source and `ghfast.top` only after a GitHub timeout.

Gitee repository mirrors keep commits, branches, and tags synchronized from GitHub. Software and Patch Package release assets remain independently published to both hosts when a future release is explicitly authorized.
