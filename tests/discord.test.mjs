import assert from "node:assert/strict";
import test from "node:test";
import { personalNotificationPayload, sendDiscordMessage, teamSummaryPayload } from "../alerts/discord.mjs";

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
