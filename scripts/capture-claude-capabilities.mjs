#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const configDir = await mkdtemp(join(tmpdir(), "cliproxy-claude-capture-"));
const mcpServerPath = join(configDir, "mcp-fixture.mjs");
const mcpConfigPath = join(configDir, "mcp.json");
await writeFile(mcpServerPath, renderMcpFixture());
await writeFile(
  mcpConfigPath,
  JSON.stringify({ mcpServers: { capture: { command: process.execPath, args: [mcpServerPath] } } }),
);
let finish;
const captured = new Promise((resolve) => (finish = resolve));
const server = createServer((request, response) => {
  if (request.method !== "POST" || !request.url.startsWith("/v1/messages") || request.url.includes("count_tokens")) {
    response.writeHead(request.method === "HEAD" ? 404 : 200, { "content-type": "application/json" });
    response.end(request.method === "HEAD" ? undefined : "{}");
    return;
  }
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolSearch = tools.find((tool) => tool.name === "ToolSearch");
    const projection = {
      method: request.method,
      path: request.url,
      bodyKeys: Object.keys(body).sort(),
      toolsType: Array.isArray(body.tools) ? "array" : typeof body.tools,
      userAgent: request.headers["user-agent"] ?? null,
      beta: request.headers["anthropic-beta"] ?? null,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name).filter(Boolean).sort(),
      toolSearch: toolSearch
        ? {
            descriptionHash: digest(toolSearch.description ?? ""),
            schema: toolSearch.input_schema,
          }
        : null,
      deferredCount: tools.filter((tool) => tool.defer_loading === true).length,
    };
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "capture complete" } }));
    finish(projection);
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
const child = spawn(
  process.env.CLAUDE_CODE_BINARY || "claude",
  [
    "--model",
    "claude-sonnet-5",
    "--dangerously-skip-permissions",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--exclude-dynamic-system-prompt-sections",
    "--append-system-prompt",
    "This is a local Claudex compatibility probe.",
    "--debug",
    "mcp",
    "-p",
    "Use one capture MCP tool, then return OK.",
  ],
  {
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: "capture-only",
    ENABLE_TOOL_SEARCH: "true",
  },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let childErrors = "";
child.stderr.setEncoding("utf8").on("data", (chunk) => (childErrors += chunk));
const timeout = setTimeout(() => finish(null), 20_000);
const result = await captured;
clearTimeout(timeout);
await new Promise((resolve) => setTimeout(resolve, 500));
child.kill("SIGTERM");
server.close();
await rm(configDir, { recursive: true, force: true });
if (!result) throw new Error(`Claude Code did not send a request within 20 seconds: ${childErrors.slice(-2_000)}`);
if (result.toolCount === 0 && childErrors.trim()) {
  result.debug = childErrors.replaceAll(configDir, "[temp]").slice(-2_000);
}
console.log(JSON.stringify(result, null, 2));

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function renderMcpFixture() {
  return `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") return send(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "capture", version: "1" } });
  if (message.method === "tools/list") return send(message.id, { tools: Array.from({length: 48}, (_, index) => ({ name: "lookup_marker_" + index, description: "Deterministic compatibility probe tool " + index + ". " + "stable description ".repeat(80), inputSchema: { type: "object", properties: { marker: { type: "string" } }, required: ["marker"], additionalProperties: false } })) });
  if (message.method === "tools/call") return send(message.id, { content: [{ type: "text", text: "OK" }] });
  if (message.id !== undefined) send(message.id, {});
});
function send(id, result) { process.stdout.write(JSON.stringify({jsonrpc:"2.0", id, result}) + "\\n"); }
`;
}
