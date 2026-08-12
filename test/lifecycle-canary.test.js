import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runIsolatedCanary } from "../src/canary.js";
import { rollback, setup, upgrade } from "../src/lifecycle.js";
import { resolvePaths } from "../src/paths.js";
import { loadState } from "../src/state.js";
import { fixtureManifest, temporaryRoot } from "../test-support/helpers.js";

test("setup installs an inspected local binary without a service", { skip: process.platform === "win32" }, async (t) => {
  const root = await temporaryRoot(t);
  const paths = resolvePaths({ env: { CLIPROXY_OAUTH_HOME: root }, home: root, platform: "linux" });
  const binary = join(root, "fake-proxy");
  await writeExecutable(
    binary,
    '#!/bin/sh\nif [ "$1" = "-h" ]; then echo "-codex-login -codex-device-login -config"; fi\n',
  );

  const result = await setup(paths, fixtureManifest(), { binary, noService: true, port: 19417 });
  const state = await loadState(paths);

  assert.equal(result.service.installed, false);
  assert.equal(state.activeRelease.sha256, result.release.sha256);
  assert.equal(await readFile(paths.currentBinary, "utf8"), await readFile(binary, "utf8"));
  assert.match(await readFile(paths.proxyConfig, "utf8"), /^port: 19417$/m);
});

test("isolated canary uses an access-only OAuth copy and exercises messages", { skip: process.platform === "win32" }, async (t) => {
  const root = await temporaryRoot(t);
  const paths = resolvePaths({ env: { CLIPROXY_OAUTH_HOME: root }, home: root, platform: "linux" });
  await mkdir(paths.authDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(paths.authDir, "codex-test.json"),
    JSON.stringify({ type: "codex", access_token: "access-only-test", refresh_token: "must-not-copy" }),
    { mode: 0o600 },
  );
  const binary = join(root, "fake-canary.mjs");
  await writeExecutable(binary, fakeCanaryServer);

  const result = await runIsolatedCanary(binary, paths, fixtureManifest());

  assert.equal(result.passed, true);
  assert.equal(result.oauthTested, true);
});

test("upgrade canaries a distinct build and rollback restores the exact prior binary", { skip: process.platform === "win32" }, async (t) => {
  const root = await temporaryRoot(t);
  const paths = resolvePaths({ env: { CLIPROXY_OAUTH_HOME: root }, home: root, platform: "linux" });
  const manifest = fixtureManifest();
  const first = join(root, "fake-proxy-v1");
  const second = join(root, "fake-proxy-v2.mjs");
  await writeExecutable(
    first,
    '#!/bin/sh\nif [ "$1" = "-h" ]; then echo "v1 -codex-login -codex-device-login -config"; fi\n',
  );
  await writeExecutable(second, fakeCanaryServer.replace("#!/usr/bin/env node", "#!/usr/bin/env node\n// v2"));
  await setup(paths, manifest, { binary: first, noService: true });
  const firstContents = await readFile(paths.currentBinary, "utf8");

  const result = await upgrade(paths, manifest, { binary: second });
  assert.equal(result.changed, true);
  assert.equal(result.canary.passed, true);
  assert.match(await readFile(paths.currentBinary, "utf8"), /\/\/ v2/);

  const restored = await rollback(paths);
  assert.equal(await readFile(paths.currentBinary, "utf8"), firstContents);
  assert.equal(restored.sha256, (await loadState(paths)).activeRelease.sha256);
});

async function writeExecutable(path, contents) {
  await writeFile(path, contents, { mode: 0o755 });
  if (process.platform !== "win32") await chmod(path, 0o755);
}

const fakeCanaryServer = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
if (process.argv.includes("-h")) {
  console.log("-codex-login -codex-device-login -config");
  process.exit(0);
}
const config = readFileSync(process.argv[process.argv.indexOf("-config") + 1], "utf8");
const port = Number(config.match(/^port: (\\d+)$/m)[1]);
const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/v1/models") {
    response.end(JSON.stringify({data:[{id:"claude-sonnet-5"},{id:"claude-haiku-4-5"}]}));
  } else if (request.url === "/v1/messages") {
    let body = "";
    request.on("data", chunk => body += chunk);
    request.on("end", () => response.end(JSON.stringify({content:[{type:"text",text:"OK"}]})));
  } else { response.statusCode = 404; response.end("{}"); }
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
