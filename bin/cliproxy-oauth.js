#!/usr/bin/env node
import { main } from "../src/cli.js";

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`cliproxy-oauth: ${error.message}`);
  if (process.env.CLIPROXY_OAUTH_DEBUG) console.error(error.stack);
  process.exitCode = 1;
}
