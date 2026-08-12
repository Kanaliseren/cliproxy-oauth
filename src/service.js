import { atomicWrite, ensureDir, exists, run } from "./util.js";
import { dirname } from "node:path";

export async function installService(paths, { platform = process.platform, runCommand = run } = {}) {
  if (platform === "linux") return installSystemd(paths, runCommand);
  if (platform === "darwin") return installLaunchd(paths, runCommand);
  return { kind: "none", installed: false, note: "automatic user services are not supported on this platform" };
}

async function installSystemd(paths, runCommand) {
  await ensureDir(dirname(paths.systemdUnit));
  const unit = `[Unit]
Description=CLIProxyAPI OAuth proxy
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdValue(paths.dataDir)}
ExecStart=${systemdValue(paths.currentBinary)} -config ${systemdValue(paths.proxyConfig)}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
`;
  await atomicWrite(paths.systemdUnit, unit, 0o600);
  await runCommand("systemctl", ["--user", "daemon-reload"]);
  await runCommand("systemctl", ["--user", "enable", "cliproxy-oauth.service"]);
  await runCommand("systemctl", ["--user", "restart", "cliproxy-oauth.service"]);
  return { kind: "systemd", installed: true, path: paths.systemdUnit };
}

async function installLaunchd(paths, runCommand) {
  await ensureDir(dirname(paths.launchdPlist));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.kanaliseren.cliproxy-oauth</string>
  <key>ProgramArguments</key><array>
    <string>${xmlEscape(paths.currentBinary)}</string>
    <string>-config</string><string>${xmlEscape(paths.proxyConfig)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xmlEscape(paths.dataDir)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xmlEscape(`${paths.stateDir}/proxy.log`)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(`${paths.stateDir}/proxy.err.log`)}</string>
</dict></plist>
`;
  await atomicWrite(paths.launchdPlist, plist, 0o600);
  const domain = `gui/${process.getuid()}`;
  await runCommand("launchctl", ["bootout", domain, paths.launchdPlist], { allowFailure: true });
  await runCommand("launchctl", ["bootstrap", domain, paths.launchdPlist]);
  return { kind: "launchd", installed: true, path: paths.launchdPlist };
}

export async function restartService(paths, { platform = process.platform, runCommand = run } = {}) {
  if (platform === "linux" && (await exists(paths.systemdUnit))) {
    await runCommand("systemctl", ["--user", "restart", "cliproxy-oauth.service"]);
    return true;
  }
  if (platform === "darwin" && (await exists(paths.launchdPlist))) {
    await runCommand("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/com.kanaliseren.cliproxy-oauth`]);
    return true;
  }
  return false;
}

export async function stopService(paths, { platform = process.platform, runCommand = run } = {}) {
  if (platform === "linux" && (await exists(paths.systemdUnit))) {
    await runCommand("systemctl", ["--user", "stop", "cliproxy-oauth.service"], { allowFailure: true });
    return true;
  }
  if (platform === "darwin" && (await exists(paths.launchdPlist))) {
    await runCommand("launchctl", ["bootout", `gui/${process.getuid()}`, paths.launchdPlist], {
      allowFailure: true,
    });
    return true;
  }
  return false;
}

export async function serviceStatus(paths, { platform = process.platform, runCommand = run } = {}) {
  if (platform === "linux" && (await exists(paths.systemdUnit))) {
    const result = await runCommand("systemctl", ["--user", "is-active", "cliproxy-oauth.service"], {
      allowFailure: true,
    });
    return { kind: "systemd", installed: true, active: result.stdout.trim() === "active" };
  }
  if (platform === "darwin" && (await exists(paths.launchdPlist))) {
    const result = await runCommand(
      "launchctl",
      ["print", `gui/${process.getuid()}/com.kanaliseren.cliproxy-oauth`],
      { allowFailure: true },
    );
    return { kind: "launchd", installed: true, active: result.code === 0 };
  }
  return { kind: "none", installed: false, active: false };
}

function systemdValue(value) {
  return `"${String(value).replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
