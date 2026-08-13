import { loadManifest } from "./manifest.js";
import { resolvePaths } from "./paths.js";
import { diagnose, statusSummary } from "./doctor.js";
import { integrate } from "./integrations.js";
import { login, rollback, setup, upgrade } from "./lifecycle.js";
import { runClaude } from "./wrapper.js";

export async function main(argv = process.argv.slice(2), io = console) {
  const [command = "help", ...tail] = argv;
  if (command === "help" || command === "--help" || command === "-h") {
    io.log(helpText);
    return 0;
  }
  if (command === "claude") {
    const manifest = await loadManifest();
    const paths = resolvePaths();
    const args = tail[0] === "--" ? tail.slice(1) : tail;
    return runClaude(paths, manifest, args);
  }
  const parsed = parseArguments(tail);
  const manifest = await loadManifest(parsed.options.manifest);
  const paths = resolvePaths();

  if (command === "setup") {
    rejectPositionals(parsed, command);
    const result = await setup(paths, manifest, {
      binary: parsed.options.binary,
      port: numberOption(parsed.options.port, "port"),
      noService: Boolean(parsed.options.noService),
    });
    io.log(`Installed ${result.release.version} (${result.release.sha256.slice(0, 12)}).`);
    io.log(`Config: ${result.config}`);
    io.log(`Claude wrapper: ${result.wrapper}`);
    if (!result.service.installed) io.log("Service was not installed; start the proxy before live use.");
    io.log("Next: claudex login");
    return 0;
  }

  if (command === "login") {
    rejectPositionals(parsed, command);
    await login(paths, { device: Boolean(parsed.options.device) });
    io.log("Codex OAuth login completed locally.");
    return 0;
  }

  if (command === "doctor") {
    rejectPositionals(parsed, command);
    const report = await diagnose(paths, manifest, { live: Boolean(parsed.options.live) });
    if (parsed.options.json) io.log(JSON.stringify(report, null, 2));
    else printDoctor(report, io);
    return report.ok ? 0 : 1;
  }

  if (command === "status") {
    rejectPositionals(parsed, command);
    const status = await statusSummary(paths);
    if (parsed.options.json) io.log(JSON.stringify(status, null, 2));
    else {
      io.log(`Active: ${status.activeRelease?.version ?? "not installed"}`);
      io.log(`Service: ${status.service.installed ? (status.service.active ? "active" : "inactive") : "not installed"}`);
      io.log(`Config: ${status.config}`);
      io.log(`Wrapper: ${status.wrapper}`);
    }
    return 0;
  }

  if (command === "update" || command === "upgrade") {
    rejectPositionals(parsed, command);
    const result = await upgrade(paths, manifest, { binary: parsed.options.binary });
    if (!result.changed) io.log(`Already on ${result.release.version} (${result.release.sha256.slice(0, 12)}).`);
    else {
      io.log(`Upgraded to ${result.release.version} (${result.release.sha256.slice(0, 12)}).`);
      io.log(`Isolated canary: passed${result.canary.oauthTested ? " with local OAuth" : " (no local OAuth credential)"}.`);
    }
    return 0;
  }

  if (command === "rollback") {
    rejectPositionals(parsed, command);
    const release = await rollback(paths);
    io.log(`Rolled back to ${release.version} (${release.sha256.slice(0, 12)}).`);
    return 0;
  }

  if (command === "integrate") {
    const [target, ...extra] = parsed.positionals;
    if (!target || extra.length > 0) throw new Error("usage: claudex integrate <paseo|t3|all> [--path PATH]");
    const results = await integrate(paths, manifest, target, { path: parsed.options.path });
    for (const result of results) io.log(`Updated ${result.target}: ${result.path} (backup: ${result.backup})`);
    io.log("No application was restarted; restart it when convenient.");
    return 0;
  }

  throw new Error(`unknown command: ${command}\n\n${helpText}`);
}

const helpText = `claudex — run Claude Code through your local Codex OAuth session

Usage:
  claudex setup [--binary PATH] [--port PORT] [--no-service]
  claudex login [--device]
  claudex doctor [--json] [--live]
  claudex update [--binary PATH]
  claudex upgrade [--binary PATH]
  claudex rollback
  claudex integrate <paseo|t3|all> [--path PATH]
  claudex claude [--] [CLAUDE OPTIONS...]
  claudex status [--json]

Environment:
  CLAUDEX_HOME         Isolate every package-owned file under one directory.
  CLIPROXY_OAUTH_HOME  Legacy alias for CLAUDEX_HOME.
  CLAUDE_CODE_BINARY   Override the Claude Code executable.
`;

function parseArguments(args) {
  const options = {};
  const positionals = [];
  const boolean = new Map([
    ["--no-service", "noService"],
    ["--device", "device"],
    ["--json", "json"],
    ["--live", "live"],
  ]);
  const valued = new Map([
    ["--binary", "binary"],
    ["--port", "port"],
    ["--path", "path"],
    ["--manifest", "manifest"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (boolean.has(value)) options[boolean.get(value)] = true;
    else if (valued.has(value)) {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value`);
      options[valued.get(value)] = next;
      index += 1;
    } else if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    else positionals.push(value);
  }
  return { options, positionals };
}

function numberOption(value, name) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`invalid ${name}: ${value}`);
  return number;
}

function rejectPositionals(parsed, command) {
  if (parsed.positionals.length > 0) throw new Error(`${command} does not accept positional arguments`);
}

function printDoctor(report, io) {
  for (const check of report.checks) {
    const symbol = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    io.log(`${symbol.padEnd(4)}  ${check.name}: ${check.detail}`);
  }
}
