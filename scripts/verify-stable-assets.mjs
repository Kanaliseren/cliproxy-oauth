#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../channel/stable.json", import.meta.url), "utf8"));
for (const [platform, asset] of Object.entries(manifest.proxy.assets)) {
  const response = await fetch(asset.url, { headers: { "user-agent": "cliproxy-oauth-ci" } });
  if (!response.ok) throw new Error(`${platform} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.archiveBytes) throw new Error(`${platform} archive size mismatch`);
  if (sha256 !== asset.archiveSha256) throw new Error(`${platform} archive checksum mismatch`);
  console.log(`${platform}: verified ${bytes.length} bytes`);
}
