import { atomicWrite, exists, readJson } from "./util.js";

export async function loadState(paths) {
  if (!(await exists(paths.stateFile))) return { schemaVersion: 1 };
  const state = await readJson(paths.stateFile);
  if (state.schemaVersion !== 1) throw new Error("unsupported local state schema");
  return state;
}

export async function saveState(paths, state) {
  await atomicWrite(paths.stateFile, `${JSON.stringify({ schemaVersion: 1, ...state }, null, 2)}\n`, 0o600);
}
