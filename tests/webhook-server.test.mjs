import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createWebhookHandler, verifyWebhookSignature } from "../alerts/webhook-server.mjs";

const secret = "It's a Secret to Everybody";

function signature(body) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function requestFor({ body, event = "issue_comment", delivery = "delivery-1", repository = "team-framework/innolive-client", signatureValue }) {
  const payload = body || Buffer.from(JSON.stringify({
    action: "created",
    repository: { full_name: repository, html_url: `https://github.com/${repository}` },
    sender: { login: "chaeyn" },
    issue: {
      number: 10,
      title: "feat: 알림",
      body: "GitHub 활동을 Discord로 전달합니다.",
      html_url: `https://github.com/${repository}/pull/10`,
      pull_request: {}
    },
    comment: { body: "확인해 주세요.", html_url: `https://github.com/${repository}/pull/10#issuecomment-1` }
  }));
  const request = Readable.from([payload]);
  request.method = "POST";
  request.url = "/github/webhooks";
  request.headers = {
    "x-github-event": event,
    "x-github-delivery": delivery,
    "x-hub-signature-256": signatureValue || signature(payload)
  };
  return request;
}

function responseRecorder() {
  let resolve;
  const completed = new Promise((done) => { resolve = done; });
  return {
    statusCode: null,
    headers: null,
    body: "",
    completed,
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body = "") { this.body += body; resolve(); }
  };
}

test("GitHub 공식 HMAC-SHA256 테스트 벡터를 검증해요", () => {
  const body = Buffer.from("Hello, World!");
  assert.equal(verifyWebhookSignature({
    secret,
    body,
    signature: "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
  }), true);
  assert.equal(verifyWebhookSignature({ secret, body, signature: "sha256=wrong" }), false);
});

test("검증된 webhook을 저장소별 Discord 채널에 한 번만 보내요", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "framework-webhook-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const config = {
    discordToken: "discord-token",
    repositories: ["team-framework/innolive-client"],
    channels: new Map([["team-framework/innolive-client", "123456789012345678"]]),
    webhookSecret: secret,
    webhookPath: "/github/webhooks",
    statePath: join(directory, "state.json")
  };
  const handler = createWebhookHandler({
    config,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/channels/123456789012345678")) {
        return { ok: true, json: async () => ({ id: "123456789012345678", guild_id: "guild-1", parent_id: "category-1", type: 0 }) };
      }
      if (url.endsWith("/guilds/guild-1/channels") && (!options.method || options.method === "GET")) {
        return { ok: true, json: async () => [] };
      }
      if (url.endsWith("/guilds/guild-1/channels") && options.method === "POST") {
        return { ok: true, json: async () => ({ id: "345678901234567890", guild_id: "guild-1", parent_id: "category-1", type: 0, topic: JSON.parse(options.body).topic }) };
      }
      if (url.endsWith("/channels/345678901234567890/messages")) {
        return { ok: true, json: async () => ({ id: "message-1" }) };
      }
      throw new Error(`예상하지 않은 Discord 요청: ${url}`);
    },
    now: () => new Date("2026-08-12T00:00:00.000Z")
  });

  for (let index = 0; index < 2; index += 1) {
    const response = responseRecorder();
    await handler(requestFor({}), response);
    await response.completed;
    assert.ok([200, 202].includes(response.statusCode));
  }

  await handler.deliveryQueue.drain();

  const messageRequests = requests.filter((request) => request.url.endsWith("/messages"));
  assert.equal(messageRequests.length, 1);
  assert.match(messageRequests[0].url, /channels\/345678901234567890\/messages$/);
  const discordPayload = JSON.parse(messageRequests[0].options.body);
  assert.match(discordPayload.embeds[0].title, /chaeyn · PR: feat: 알림 · 일반 댓글/);
  assert.doesNotMatch(discordPayload.embeds[0].description, /PR 본문/);
  assert.match(discordPayload.embeds[0].description, /확인해 주세요/);
  const state = JSON.parse(await readFile(config.statePath, "utf8"));
  assert.equal(state.deliveries["delivery-1"], "2026-08-12T00:00:00.000Z");
  assert.equal(state.prChannels["team-framework/innolive-client#10"].channelId, "345678901234567890");
});

test("서명이 틀리거나 허용되지 않은 저장소의 webhook은 거부해요", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "framework-webhook-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let requestCount = 0;
  const handler = createWebhookHandler({
    config: {
      discordToken: "discord-token",
      repositories: ["team-framework/innolive-client"],
      channels: new Map([["team-framework/innolive-client", "123456789012345678"]]),
      webhookSecret: secret,
      webhookPath: "/github/webhooks",
      statePath: join(directory, "state.json")
    },
    fetchImpl: async () => { requestCount += 1; return { ok: true, json: async () => ({}) }; }
  });

  const invalidSignatureResponse = responseRecorder();
  await handler(requestFor({ signatureValue: "sha256=invalid" }), invalidSignatureResponse);
  assert.equal(invalidSignatureResponse.statusCode, 401);

  const otherRepositoryResponse = responseRecorder();
  await handler(requestFor({ repository: "team-framework/other", delivery: "delivery-2" }), otherRepositoryResponse);
  assert.equal(otherRepositoryResponse.statusCode, 403);
  assert.equal(requestCount, 0);
});
