import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const MAX_DELIVERIES = 10_000;
const MAX_AGE_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export async function loadWebhookState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state?.version !== VERSION || !state.deliveries || typeof state.deliveries !== "object" || Array.isArray(state.deliveries)) {
      throw new Error("지원하지 않는 GitHub webhook 상태 형식이에요.");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return { version: VERSION, deliveries: {} };
    throw error;
  }
}

export function hasDelivery(state, deliveryId) {
  return Boolean(state.deliveries[deliveryId]);
}

export function rememberDelivery(state, deliveryId, now = new Date()) {
  state.deliveries[deliveryId] = now.toISOString();
  const cutoff = now.getTime() - MAX_AGE_MILLISECONDS;
  const entries = Object.entries(state.deliveries)
    .filter(([, timestamp]) => new Date(timestamp).getTime() >= cutoff)
    .sort((left, right) => new Date(right[1]) - new Date(left[1]))
    .slice(0, MAX_DELIVERIES);
  state.deliveries = Object.fromEntries(entries);
}

export async function saveWebhookState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}
