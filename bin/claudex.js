#!/usr/bin/env node
import { main } from "../src/cli.js";

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`claudex: ${error.message}`);
  if (process.env.CLAUDEX_DEBUG ?? process.env.CLIPROXY_OAUTH_DEBUG) console.error(error.stack);
  process.exitCode = 1;
}
