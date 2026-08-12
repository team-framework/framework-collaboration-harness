import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createActivityDeliveryQueue } from "../alerts/activity-delivery-queue.mjs";

function activity() {
  return {
    repository: "team-framework/innolive-client",
    actor: "chaeyn",
    event: "push",
    summary: "main에 1개 커밋을 push했어요",
    detail: "- `1234567` feat: 활동 알림 추가",
    url: "https://github.com/team-framework/innolive-client/commit/1234567"
  };
}

test("Discord 장애가 나면 활동을 디스크에 남기고 다음 drain에서 재전송해요", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "framework-activity-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let shouldFail = true;
  let retries = 0;
  const statePath = join(directory, "state.json");
  const queue = createActivityDeliveryQueue({
    config: {
      discordToken: "discord-token",
      channels: new Map([["team-framework/innolive-client", "123456789012345678"]]),
      statePath
    },
    fetchImpl: async () => {
      if (shouldFail) return { ok: false, status: 503, text: async () => "unavailable" };
      return { ok: true, json: async () => ({ id: "message-1" }) };
    },
    scheduleRetry: () => { retries += 1; return { unref() {} }; },
    now: () => new Date("2026-08-12T00:00:00.000Z")
  });

  assert.equal(await queue.enqueue({ deliveryId: "delivery-1", activity: activity() }), "accepted");
  await assert.rejects(() => queue.drain(), /503/);
  assert.equal((await readdir(`${statePath}.queue`)).length, 1);

  shouldFail = false;
  await queue.drain();
  assert.equal((await readdir(`${statePath}.queue`)).length, 0);
  assert.equal(await queue.enqueue({ deliveryId: "delivery-1", activity: activity() }), "duplicate");
  assert.equal(retries, 1);
});

test("전송 중 추가된 활동도 다음 이벤트를 기다리지 않고 이어서 보내요", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "framework-activity-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let requestCount = 0;
  const statePath = join(directory, "state.json");
  const queue = createActivityDeliveryQueue({
    config: {
      discordToken: "discord-token",
      channels: new Map([["team-framework/innolive-client", "123456789012345678"]]),
      statePath
    },
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        markFirstStarted();
        await firstGate;
      }
      return { ok: true, json: async () => ({ id: `message-${requestCount}` }) };
    }
  });

  await queue.enqueue({ deliveryId: "delivery-1", activity: activity() });
  await firstStarted;
  await queue.enqueue({ deliveryId: "delivery-2", activity: activity() });
  await queue.enqueue({ deliveryId: "delivery-3", activity: activity() });
  releaseFirst();
  await queue.drain();

  assert.equal(requestCount, 3);
  assert.equal((await readdir(`${statePath}.queue`)).length, 0);
});
