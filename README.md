# cliproxy-oauth

Portable, fail-closed lifecycle management for using local ChatGPT/Codex OAuth
through CLIProxyAPI from Claude Code, Paseo, and T3 Code.

OAuth credentials are created locally on every machine. They are never bundled,
uploaded, copied between users, or printed by this package.

## Install

Until the first npm registry release, run directly from GitHub:

```bash
npx --yes github:Kanaliseren/cliproxy-oauth setup
npx --yes github:Kanaliseren/cliproxy-oauth login
npx --yes github:Kanaliseren/cliproxy-oauth doctor --live
```

Node.js 20 or newer is required for `npx`. `setup` downloads only a platform
binary whose compressed archive and extracted executable are both pinned by
SHA-256 in the stable-channel manifest.

After npm publication:

```bash
npx --yes cliproxy-oauth@latest setup
cliproxy-oauth login
cliproxy-oauth integrate all
```

`setup` installs a checksum-pinned, compatibility-tested CLIProxyAPI build,
generates a loopback-only configuration, installs a user service where the
platform supports one, and creates `~/.local/bin/claude-cliproxy`.

Run `setup` and `login` separately on every machine and for every user. Do not
copy the generated OAuth files between machines.

## Commands

```text
cliproxy-oauth setup [--binary PATH] [--port PORT] [--no-service]
cliproxy-oauth login [--device]
cliproxy-oauth doctor [--json] [--live]
cliproxy-oauth upgrade [--binary PATH]
cliproxy-oauth rollback
cliproxy-oauth integrate <paseo|t3|all> [--path PATH]
cliproxy-oauth claude [CLAUDE OPTIONS...]
cliproxy-oauth status [--json]
```

Set `CLIPROXY_OAUTH_HOME` to redirect every package-owned file into an isolated
directory. This is useful for CI and canary installations.

## Upgrade policy

This project deliberately does not activate an arbitrary newest upstream build.
Each package release pins exact binaries and checksums. `upgrade` stages the
candidate, checks required capabilities, runs an isolated OAuth canary when a
local credential is available, then atomically activates it. Failed candidates
leave the current release running.

Claude Code and provider integrations are capability-detected and preserve
unknown configuration fields. Unsupported future schemas fail without writing.

## Security model

- Proxy listener: `127.0.0.1` only.
- Remote management and the control panel: disabled.
- Config and OAuth files: user-only permissions.
- Inbound proxy key: random per installation.
- Upgrade canary: separate temporary auth directory with refresh tokens removed.
- No automatic credential sharing between machines or people.

## Compatibility

The exact tested matrix is in [`channel/stable.json`](channel/stable.json).
Scheduled CI detects new CLIProxyAPI releases, but promotion stays gated on the
test suite, protocol capture, and a real local OAuth canary. Unknown Claude Code
versions keep the basic proxy workflow but leave optimized native ToolSearch
disabled until their request/response shape has passed certification. No wrapper can honestly guarantee
compatibility with every future provider release without this promotion step.

The current stable channel is based on CLIProxyAPI `v7.2.130` and has been
tested end-to-end with Claude Code `2.1.226` and `2.1.228`, including direct
requests, sequential and parallel subagents, and deferred MCP ToolSearch.
