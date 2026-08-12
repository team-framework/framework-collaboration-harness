import assert from "node:assert/strict";
import test from "node:test";
import {
  pullRequestChannelMarker,
  pullRequestChannelName,
  resolveActivityChannel
} from "../alerts/pr-channels.mjs";

const repositoryChannelId = "123456789012345678";
const pullRequestChannelId = "234567890123456789";

function activity(overrides = {}) {
  return {
    repository: "team-framework/framework-collaboration-harness",
    pullRequest: {
      number: 3,
      title: "feat: GitHub 활동 Discord 알림",
      url: "https://github.com/team-framework/framework-collaboration-harness/pull/3",
      state: "open",
      terminal: false,
      ...overrides
    }
  };
}

function config() {
  return {
    discordToken: "discord-token",
    channels: new Map([["team-framework/framework-collaboration-harness", repositoryChannelId]])
  };
}

test("PR별 채널 이름과 식별 marker를 안정적으로 만들어요", () => {
  assert.equal(pullRequestChannelName("team-framework/framework-collaboration-harness", 3), "framework-collaboration-harness-pr-3");
  assert.equal(pullRequestChannelMarker("team-framework/framework-collaboration-harness", 3), "[framework-github-pr:team-framework/framework-collaboration-harness#3]");
});

test("저장소 채널과 같은 카테고리에 PR 채널을 만들고 상태에 기억해요", async () => {
  const requests = [];
  const state = { version: 2, deliveries: {}, prChannels: {} };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith(`/channels/${repositoryChannelId}`)) {
      return { ok: true, json: async () => ({ id: repositoryChannelId, guild_id: "guild-1", parent_id: "category-1", type: 0 }) };
    }
    if (url.endsWith("/guilds/guild-1/channels") && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => [] };
    }
    if (url.endsWith("/guilds/guild-1/channels") && options.method === "POST") {
      const body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: pullRequestChannelId, guild_id: "guild-1", parent_id: body.parent_id, topic: body.topic, type: 0 }) };
    }
    throw new Error(`예상하지 않은 요청: ${url}`);
  };

  assert.equal(await resolveActivityChannel({ config: config(), activity: activity(), state, fetchImpl }), pullRequestChannelId);
  assert.equal(state.prChannels["team-framework/framework-collaboration-harness#3"].channelId, pullRequestChannelId);
  const createRequest = requests.find((request) => request.options.method === "POST");
  assert.deepEqual(JSON.parse(createRequest.options.body), {
    name: "framework-collaboration-harness-pr-3",
    type: 0,
    parent_id: "category-1",
    topic: "[framework-github-pr:team-framework/framework-collaboration-harness#3] feat: GitHub 활동 Discord 알림 · https://github.com/team-framework/framework-collaboration-harness/pull/3 · 상태: open"
  });
});

test("이미 닫힌 PR 채널이 삭제된 뒤에는 댓글로 다시 만들지 않아요", async () => {
  const state = {
    version: 2,
    deliveries: {},
    prChannels: {
      "team-framework/framework-collaboration-harness#3": { channelId: pullRequestChannelId }
    }
  };
  let createCount = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith(`/channels/${pullRequestChannelId}`)) return { ok: false, status: 404, json: async () => ({}) };
    if (url.endsWith(`/channels/${repositoryChannelId}`)) {
      return { ok: true, json: async () => ({ id: repositoryChannelId, guild_id: "guild-1", parent_id: "category-1", type: 0 }) };
    }
    if (url.endsWith("/guilds/guild-1/channels") && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => [] };
    }
    if (options.method === "POST") createCount += 1;
    throw new Error(`예상하지 않은 요청: ${url}`);
  };

  const result = await resolveActivityChannel({
    config: config(),
    activity: activity({ state: "closed", terminal: false }),
    state,
    fetchImpl
  });
  assert.equal(result, null);
  assert.equal(createCount, 0);
  assert.equal(state.prChannels["team-framework/framework-collaboration-harness#3"], undefined);
});
