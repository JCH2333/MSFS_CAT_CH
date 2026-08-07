# MSFS_CAT_CH

Windows desktop application for installing, checking, updating, and restoring Microsoft Flight Simulator add-on Chinese localization patches. Software releases and Patch Packages are distributed only through GitHub; the application has no account, activation, telemetry, or custom server.

## For users

1. Download and run the Windows installer from the latest [Software Release](https://github.com/JCH2333/MSFS_CAT_CH/releases).
2. In **Chinese Patches**, select the GSX installation directory when prompted.
3. Select **Install Patch**. The tool downloads a Patch Package, verifies its SHA-256 checksum, backs up replaced files, then installs it.
4. Use **Check Integrity** to confirm installed files still match the recorded patch. A modified or missing file is never silently changed during the check.
5. Use **Restore** to recover backed-up original files. Files introduced by a Patch Package are removed only when they still match the installed hash.

The application refreshes the Patch Catalog from GitHub when it starts. If GitHub is temporarily unavailable, it uses the most recent locally cached catalog. Packaged releases also check GitHub Releases for software updates shortly after launch; downloading and installing an update always remains an explicit user action.

## Patch states

- **Not installed**: no Installation Record exists on this computer.
- **Installed**: the Installation Record matches the Patch Catalog and all recorded files are intact.
- **Update available**: the Patch Catalog has a newer semantic version.
- **Needs repair**: an installed file was changed or is missing. Reinstall only after reviewing local changes; Restore preserves user-modified introduced files as conflicts.
- **Local version is newer**: the currently installed patch is newer than the catalog entry.

## Development

```powershell
npm ci
npm test
npm run build
npm run dist:win
```

## Release process

`v*` tags trigger the Windows release workflow. Before publishing, run the tests and build, inspect the installer asset and its version, then create the matching Software Release. Publish a Patch Catalog entry only after its Patch Package asset exists and its SHA-256 checksum has been verified. See [docs/patch-catalog.md](docs/patch-catalog.md).
