import { atomicWrite, run, shellQuote } from "./util.js";
import { readProxyKey, readProxySummary } from "./config.js";

const identityPrompt =
  "This Claude Code session uses a local CLIProxyAPI OAuth bridge. Preserve Claude Code native tools, subagents, and workflow semantics.";

export async function writeClaudeWrapper(paths, manifest, { platform = process.platform } = {}) {
  const summary = await readProxySummary(paths.proxyConfig);
  if (platform === "win32") {
    const script = renderWindowsWrapper(paths, manifest, `http://${summary.host}:${summary.port}`);
    await atomicWrite(paths.wrapper, script, 0o700);
    return paths.wrapper;
  }
  const script = renderUnixWrapper(paths, manifest, `http://${summary.host}:${summary.port}`);
  await atomicWrite(paths.wrapper, script, 0o700);
  return paths.wrapper;
}

export async function claudeEnvironment(paths, manifest, { enableToolSearch = true } = {}) {
  const summary = await readProxySummary(paths.proxyConfig);
  const proxyKey = await readProxyKey(paths.proxyConfig);
  return {
    ANTHROPIC_BASE_URL: `http://${summary.host}:${summary.port}`,
    ANTHROPIC_AUTH_TOKEN: proxyKey,
    ANTHROPIC_MODEL: manifest.models.sol.alias,
    ANTHROPIC_DEFAULT_SONNET_MODEL: manifest.models.sol.alias,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: manifest.models.terra.alias,
    ...(enableToolSearch ? { ENABLE_TOOL_SEARCH: "true" } : {}),
    API_TIMEOUT_MS: "3000000",
  };
}

export async function runClaude(paths, manifest, args, { runCommand = run } = {}) {
  const binary = process.env.CLAUDE_CODE_BINARY || "claude";
  const [help, versionResult] = await Promise.all([
    runCommand(binary, ["--help"], { allowFailure: true, timeout: 15_000 }),
    runCommand(binary, ["--version"], { allowFailure: true, timeout: 15_000 }),
  ]);
  if (help.code !== 0) throw new Error(`Claude Code is unavailable: ${help.stderr.trim()}`);
  const supported = `${help.stdout}\n${help.stderr}`;
  const dynamicArgs = [];
  if (supported.includes("--exclude-dynamic-system-prompt-sections")) {
    dynamicArgs.push("--exclude-dynamic-system-prompt-sections");
  }
  if (supported.includes("--append-system-prompt")) {
    dynamicArgs.push("--append-system-prompt", identityPrompt);
  }
  const version = `${versionResult.stdout} ${versionResult.stderr}`.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0];
  const enableToolSearch = manifest.compatibility.claudeCode.tested.includes(version);
  const result = await runCommand(binary, [...dynamicArgs, ...args], {
    env: await claudeEnvironment(paths, manifest, { enableToolSearch }),
    stdio: "inherit",
    timeout: 0,
    allowFailure: true,
  });
  return result.code;
}

function renderUnixWrapper(paths, manifest, baseUrl) {
  const sol = shellQuote(manifest.models.sol.alias);
  const terra = shellQuote(manifest.models.terra.alias);
  const testedVersions = manifest.compatibility.claudeCode.tested.map((version) => `*${version}*`).join("|");
  return `#!/bin/sh
set -eu
claude_binary=\${CLAUDE_CODE_BINARY:-claude}
if ! command -v "$claude_binary" >/dev/null 2>&1; then
  echo "Claude Code is not installed or CLAUDE_CODE_BINARY is invalid" >&2
  exit 127
fi
proxy_key=$(awk '/^api-keys:/{found=1; next} found && /^[[:space:]]*-[[:space:]]*/ {sub(/^[[:space:]]*-[[:space:]]*/, ""); gsub(/^"|"$/, ""); print; exit}' ${shellQuote(paths.proxyConfig)})
if [ -z "$proxy_key" ]; then
  echo "No proxy key found in ${paths.proxyConfig}" >&2
  exit 1
fi
claude_help=$("$claude_binary" --help 2>&1 || true)
claude_version=$("$claude_binary" --version 2>&1 || true)
set -- "$@"
case "$claude_help" in *--append-system-prompt*) set -- --append-system-prompt ${shellQuote(identityPrompt)} "$@";; esac
case "$claude_help" in *--exclude-dynamic-system-prompt-sections*) set -- --exclude-dynamic-system-prompt-sections "$@";; esac
export ANTHROPIC_BASE_URL=${shellQuote(baseUrl)}
export ANTHROPIC_AUTH_TOKEN="$proxy_key"
export ANTHROPIC_MODEL=${sol}
export ANTHROPIC_DEFAULT_SONNET_MODEL=${sol}
export ANTHROPIC_DEFAULT_HAIKU_MODEL=${terra}
case "$claude_version" in ${testedVersions}) export ENABLE_TOOL_SEARCH=true;; *) unset ENABLE_TOOL_SEARCH;; esac
export API_TIMEOUT_MS=3000000
exec "$claude_binary" "$@"
`;
}

function renderWindowsWrapper(paths, manifest, baseUrl) {
  const tested = manifest.compatibility.claudeCode.tested.map((version) => `/c:"${version}"`).join(" ");
  return `@echo off\r
setlocal EnableExtensions EnableDelayedExpansion\r
set "claude_binary=%CLAUDE_CODE_BINARY%"\r
if not defined claude_binary set "claude_binary=claude"\r
set "proxy_key="\r
for /f "tokens=2" %%K in ('findstr /r /c:"^  - " "${paths.proxyConfig}"') do if not defined proxy_key set "proxy_key=%%~K"\r
if not defined proxy_key (echo No proxy key found in ${paths.proxyConfig} 1>&2 & exit /b 1)\r
set "ANTHROPIC_BASE_URL=${baseUrl}"\r
set "ANTHROPIC_AUTH_TOKEN=!proxy_key!"\r
set "ANTHROPIC_MODEL=${manifest.models.sol.alias}"\r
set "ANTHROPIC_DEFAULT_SONNET_MODEL=${manifest.models.sol.alias}"\r
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=${manifest.models.terra.alias}"\r
set "API_TIMEOUT_MS=3000000"\r
for /f "delims=" %%V in ('"!claude_binary!" --version 2^>^&1') do if not defined claude_version set "claude_version=%%V"\r
echo !claude_version! | findstr ${tested} >nul && set "ENABLE_TOOL_SEARCH=true"\r
set "dynamic_args="\r
"!claude_binary!" --help 2>&1 | findstr /c:"--exclude-dynamic-system-prompt-sections" >nul && set "dynamic_args=--exclude-dynamic-system-prompt-sections"\r
"!claude_binary!" --help 2>&1 | findstr /c:"--append-system-prompt" >nul && set "dynamic_args=!dynamic_args! --append-system-prompt \"${identityPrompt}\""\r
"!claude_binary!" !dynamic_args! %*\r
exit /b !errorlevel!\r
`;
}
