# Security

Do not include OAuth credentials, proxy keys, configuration files, or auth
directories in bug reports. `cliproxy-oauth doctor --json` is designed to be
shareable and omits these values.

Report a suspected credential leak privately to the repository owner. Revoke
the affected OAuth session immediately and perform a new local login.

Release binaries are accepted only when both the compressed asset and the
extracted executable match the checksums in `channel/stable.json`.
