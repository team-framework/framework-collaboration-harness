import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVITY_COLORS } from "../alerts/github-activity.mjs";
import { activityNotificationPayload, CLOSE_PR_CHANNEL_CUSTOM_ID, personalNotificationPayload, sendDiscordMessage, teamSummaryPayload } from "../alerts/discord.mjs";

test("개인 알림은 지정한 사용자만 멘션해요", () => {
  assert.deepEqual(personalNotificationPayload({ userId: "123456789012345678", message: "리뷰를 확인해 주세요." }), {
    content: "<@123456789012345678> 리뷰를 확인해 주세요.",
    allowed_mentions: { parse: [], users: ["123456789012345678"] }
  });
});

test("일일 요약은 지정한 역할만 멘션해요", () => {
  assert.deepEqual(teamSummaryPayload({ roleId: "123456789012345678", message: "오늘 처리할 PR이 있어요." }), {
    content: "<@&123456789012345678> 오늘 처리할 PR이 있어요.",
    allowed_mentions: { parse: [], roles: ["123456789012345678"] }
  });
});

test("Discord Bot API로 채널 메시지를 전송해요", async () => {
  const requests = [];
  const result = await sendDiscordMessage({
    token: "test-token",
    channelId: "123456789012345678",
    payload: personalNotificationPayload({ userId: "234567890123456789", message: "작업을 시작해 주세요." }),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ id: "345678901234567890" }) };
    }
  });

  assert.equal(result.id, "345678901234567890");
  assert.equal(requests[0].url, "https://discord.com/api/v10/channels/123456789012345678/messages");
  assert.equal(requests[0].options.headers.Authorization, "Bot test-token");
});

test("GitHub 활동 메시지는 어떤 Discord 멘션도 실행하지 않아요", () => {
  const payload = activityNotificationPayload({
    repository: "team-framework/innolive-client",
    actor: "chaeyn",
    event: "issue_comment",
    summary: "chaeyn · PR: feat: 실시간 방송 추가 · 일반 댓글을 작성했어요",
    detail: "**PR 본문**\n방송 기능을 추가합니다.\n**일반 댓글**\n> @everyone 확인해 주세요.",
    url: "https://github.com/team-framework/innolive-client/pull/10#issuecomment-1",
    color: ACTIVITY_COLORS.comment
  });

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.embeds[0].author.name, "team-framework/innolive-client · chaeyn");
  assert.equal(payload.embeds[0].color, ACTIVITY_COLORS.comment);
  assert.match(payload.embeds[0].title, /chaeyn · PR: feat: 실시간 방송 추가/);
  assert.match(payload.embeds[0].description, /PR 본문/);
  assert.match(payload.embeds[0].description, /@everyone/);
});

test("병합 또는 Close 알림에만 PR 채널 닫기 버튼을 넣어요", () => {
  const base = {
    repository: "team-framework/innolive-client",
    actor: "chaeyn",
    event: "pull_request",
    summary: "chaeyn · PR: feat: 방송 추가 · 병합했어요",
    url: "https://github.com/team-framework/innolive-client/pull/10"
  };
  const terminal = activityNotificationPayload({
    ...base,
    pullRequest: { number: 10, terminal: true }
  });
  const active = activityNotificationPayload({
    ...base,
    pullRequest: { number: 10, terminal: false }
  });

  assert.equal(terminal.components[0].components[0].custom_id, CLOSE_PR_CHANNEL_CUSTOM_ID);
  assert.equal(terminal.components[0].components[0].style, 4);
  assert.equal(active.components, undefined);
});
