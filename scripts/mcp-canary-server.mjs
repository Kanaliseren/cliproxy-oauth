#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const logPath = process.env.CLIPROXY_MCP_CANARY_LOG;
const tools = Array.from({ length: 48 }, (_, index) => ({
  name: `lookup_marker_${index}`,
  description: `Deterministic CLIProxyAPI compatibility tool ${index}. ${"Stable deferred tool description. ".repeat(80)}`,
  inputSchema: {
    type: "object",
    properties: { marker: { type: "string", description: "Marker returned unchanged" } },
    required: ["marker"],
    additionalProperties: false,
  },
}));

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (logPath && message.method) await appendFile(logPath, `${message.method}\n`).catch(() => {});
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "claudex-canary", version: "1.0.0" },
    });
  } else if (message.method === "tools/list") {
    reply(message.id, { tools });
  } else if (message.method === "tools/call") {
    const marker = String(message.params?.arguments?.marker ?? "");
    reply(message.id, { content: [{ type: "text", text: `CLIPROXY_MCP_OK:${marker}` }] });
  } else if (message.id !== undefined) {
    reply(message.id, {});
  }
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
