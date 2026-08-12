import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { installService, stopService } from "../src/service.js";
import { resolvePaths } from "../src/paths.js";
import { temporaryRoot } from "../test-support/helpers.js";

test("systemd setup enables and restarts the service", async (t) => {
  const root = await temporaryRoot(t);
  const paths = resolvePaths({ env: { CLIPROXY_OAUTH_HOME: root }, home: root, platform: "linux" });
  paths.systemdUnit = join(root, "systemd", "cliproxy-oauth.service");
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: "", stderr: "" };
  };

  await installService(paths, { platform: "linux", runCommand });

  assert.deepEqual(calls, [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "cliproxy-oauth.service"],
    ["systemctl", "--user", "restart", "cliproxy-oauth.service"],
  ]);
});

test("failed initial setup can stop its package-owned service", async (t) => {
  const root = await temporaryRoot(t);
  const paths = resolvePaths({ env: { CLIPROXY_OAUTH_HOME: root }, home: root, platform: "linux" });
  paths.systemdUnit = join(root, "cliproxy-oauth.service");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(paths.systemdUnit, "[Unit]\n");
  const calls = [];

  await stopService(paths, {
    platform: "linux",
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls[0].args, ["--user", "stop", "cliproxy-oauth.service"]);
  assert.equal(calls[0].options.allowFailure, true);
});
