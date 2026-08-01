import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY_STATE = Object.freeze({ version: 1, sent: {}, observedBranches: {} });

export async function loadState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1 || typeof parsed.sent !== "object" || typeof parsed.observedBranches !== "object") {
      throw new Error("지원하지 않는 알림 상태 형식이에요.");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(EMPTY_STATE);
    throw error;
  }
}

export async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

export function updateObservedBranches(state, branches, now) {
  for (const branch of branches) {
    if (!state.observedBranches[branch.key]) state.observedBranches[branch.key] = now.toISOString();
    branch.firstObservedAt = state.observedBranches[branch.key];
  }
}

export function selectUnsentAlerts(state, alerts) {
  const activeKeys = new Set(alerts.map((alert) => alert.key));
  const unsent = alerts.filter((alert) => !state.sent[alert.key]);
  state.sent = Object.fromEntries(Object.entries(state.sent).filter(([key]) => activeKeys.has(key)));
  for (const alert of unsent) state.sent[alert.key] = new Date().toISOString();
  return unsent;
}
