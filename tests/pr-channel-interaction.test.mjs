import assert from "node:assert/strict";
import test from "node:test";
import { CLOSE_PR_CHANNEL_CUSTOM_ID } from "../alerts/discord.mjs";
import { canClosePullRequestChannel, handlePullRequestChannelInteraction } from "../alerts/pr-channel-interaction.mjs";

function interaction(permissions = String(1 << 4)) {
  return {
    id: "123456789012345678",
    application_id: "234567890123456789",
    token: "interaction-token",
    type: 3,
    channel_id: "345678901234567890",
    data: { custom_id: CLOSE_PR_CHANNEL_CUSTOM_ID },
    member: { permissions }
  };
}

test("채널 관리 권한이 있는 사용자만 닫기 버튼을 실행할 수 있어요", () => {
  assert.equal(canClosePullRequestChannel(interaction(String(1 << 4))), true);
  assert.equal(canClosePullRequestChannel(interaction(String(1 << 3))), true);
  assert.equal(canClosePullRequestChannel(interaction("0")), false);
});

test("닫힌 GitHub PR 채널의 버튼을 누르면 응답 후 채널을 삭제해요", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/channels/345678901234567890") && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ topic: "[framework-github-pr:team-framework/repo#7] 제목 · url · 상태: closed" }) };
    }
    if (url.includes("/interactions/") && url.endsWith("/callback")) return { ok: true, status: 204 };
    if (url.endsWith("/channels/345678901234567890") && options.method === "DELETE") return { ok: true, status: 204 };
    throw new Error(`예상하지 않은 요청: ${url}`);
  };

  assert.equal(await handlePullRequestChannelInteraction({ interaction: interaction(), token: "discord-token", fetchImpl }), true);
  assert.equal(requests.at(-1).options.method, "DELETE");
  const response = JSON.parse(requests.find((request) => request.url.includes("/interactions/")).options.body);
  assert.equal(response.data.flags, 64);
});

test("권한이 없으면 채널을 삭제하지 않고 비공개로 안내해요", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 204 };
  };

  assert.equal(await handlePullRequestChannelInteraction({ interaction: interaction("0"), token: "discord-token", fetchImpl }), true);
  assert.equal(requests.some((request) => request.options.method === "DELETE"), false);
  const response = JSON.parse(requests[0].options.body);
  assert.match(response.data.content, /채널 관리 권한/);
});
