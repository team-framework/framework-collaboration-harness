import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { activityNotificationPayload, sendDiscordMessage } from "./discord.mjs";
import { resolveActivityChannel } from "./pr-channels.mjs";
import { hasDelivery, loadWebhookState, rememberDelivery, saveWebhookState } from "./webhook-state.mjs";

const RETRY_DELAY_MILLISECONDS = 30_000;

function deliveryFileName(deliveryId) {
  return `${createHash("sha256").update(deliveryId).digest("hex")}.json`;
}

export function createActivityDeliveryQueue({ config, fetchImpl = fetch, now = () => new Date(), scheduleRetry = setTimeout, resolveChannel = resolveActivityChannel }) {
  const queueDirectory = `${config.statePath}.queue`;
  let draining = null;
  let drainRequested = false;
  let retryTimer = null;

  async function enqueue({ deliveryId, activity }) {
    const state = await loadWebhookState(config.statePath);
    if (hasDelivery(state, deliveryId)) return "duplicate";

    await mkdir(queueDirectory, { recursive: true });
    const path = join(queueDirectory, deliveryFileName(deliveryId));
    try {
      await writeFile(path, `${JSON.stringify({ deliveryId, activity })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error.code === "EEXIST") return "duplicate";
      throw error;
    }
    triggerDrain();
    return "accepted";
  }

  async function runDrain() {
    await mkdir(queueDirectory, { recursive: true });
    const files = (await readdir(queueDirectory)).filter((file) => file.endsWith(".json")).sort();
    const state = await loadWebhookState(config.statePath);

    for (const file of files) {
      const path = join(queueDirectory, file);
      const queued = JSON.parse(await readFile(path, "utf8"));
      if (!hasDelivery(state, queued.deliveryId)) {
        const channelId = await resolveChannel({ config, activity: queued.activity, state, fetchImpl });
        if (channelId) {
          await sendDiscordMessage({
            token: config.discordToken,
            channelId,
            payload: activityNotificationPayload(queued.activity),
            fetchImpl
          });
        }
        rememberDelivery(state, queued.deliveryId, now());
        await saveWebhookState(config.statePath, state);
      }
      await unlink(path);
    }
  }

  async function runDrainLoop() {
    do {
      drainRequested = false;
      await runDrain();
    } while (drainRequested);
  }

  function drain() {
    if (draining) return draining;
    draining = runDrainLoop().finally(() => { draining = null; });
    return draining;
  }

  function triggerDrain() {
    drainRequested = true;
    void drain().catch((error) => {
      console.error(`GitHub 활동 Discord 전송에 실패했어요: ${error.message}`);
      if (retryTimer) return;
      retryTimer = scheduleRetry(() => {
        retryTimer = null;
        triggerDrain();
      }, RETRY_DELAY_MILLISECONDS);
      retryTimer?.unref?.();
    });
  }

  return { drain, enqueue, triggerDrain };
}
