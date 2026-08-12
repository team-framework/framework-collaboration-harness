import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThreadTranscript,
  fetchThreadMessages,
  formatThreadSummary,
  handleThreadSummaryInteraction,
  summarizeThread,
  threadSummaryCommandDefinition
} from "../alerts/thread-summary.mjs";

test("스레드 정리 슬래시 명령을 정의해요", () => {
  assert.deepEqual(threadSummaryCommandDefinition(), {
    name: "스레드-정리",
    description: "현재 스레드의 원인, 진행 과정, 결론을 정리해요.",
    type: 1,
    dm_permission: false
  });
});

test("봇 메시지를 제외하고 작성자를 익명화한 뒤 오래된 메시지부터 대화문을 만들어요", () => {
  const transcript = buildThreadTranscript({
    botUserId: "999",
    messages: [
      { timestamp: "2026-08-11T02:00:00Z", author: { id: "2", username: "server" }, content: "설정을 수정했어요.", mentions: [] },
      { timestamp: "2026-08-11T01:00:00Z", author: { id: "1", username: "client" }, content: "음성이 안 나와요.", mentions: [] },
      { timestamp: "2026-08-11T03:00:00Z", author: { id: "999", username: "Framework Bot" }, content: "이전 요약", mentions: [] }
    ]
  });
  assert.equal(transcript, [
    "[2026-08-11T01:00:00.000Z] 참여자 1: 음성이 안 나와요.",
    "[2026-08-11T02:00:00.000Z] 참여자 2: 설정을 수정했어요."
  ].join("\n"));
});

test("사용자 멘션도 같은 익명 참여자로 바꿔요", () => {
  const transcript = buildThreadTranscript({
    botUserId: "999",
    messages: [
      {
        timestamp: "2026-08-11T01:00:00Z",
        author: { id: "1", username: "client" },
        content: "<@2> 설정을 확인해 주세요.",
        mentions: [{ id: "2", username: "server" }]
      },
      {
        timestamp: "2026-08-11T02:00:00Z",
        author: { id: "2", username: "server" },
        content: "확인했어요.",
        mentions: []
      }
    ]
  });
  assert.equal(transcript, [
    "[2026-08-11T01:00:00.000Z] 참여자 1: @참여자 2 설정을 확인해 주세요.",
    "[2026-08-11T02:00:00.000Z] 참여자 2: 확인했어요."
  ].join("\n"));
});

test("메시지를 페이지 단위로 읽고 시간순으로 정렬해요", async () => {
  const calls = [];
  const pages = [
    [
      { id: "3", timestamp: "2026-08-11T03:00:00Z" },
      { id: "2", timestamp: "2026-08-11T02:00:00Z" }
    ],
    [{ id: "1", timestamp: "2026-08-11T01:00:00Z" }]
  ];
  const messages = await fetchThreadMessages({
    token: "token",
    channelId: "123456789012345678",
    maxMessages: 3,
    pageSize: 2,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => pages.shift() };
    }
  });
  assert.deepEqual(messages.map((message) => message.id), ["1", "2", "3"]);
  assert.match(calls[1], /before=2/);
});

test("OpenAI Structured Output으로 스레드를 정리해요", async () => {
  let request;
  const summary = await summarizeThread({
    apiKey: "secret",
    model: "gpt-5-mini",
    transcript: "대화",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ cause: ["원인"], process: ["과정"], conclusion: ["결론"] }) }] }] })
      };
    }
  });
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(summary, { cause: ["원인"], process: ["과정"], conclusion: ["결론"] });
});

test("원본 메시지 답글에 넣을 3단계 요약을 만들어요", () => {
  const content = formatThreadSummary({
    guildId: "123456789012345678",
    threadId: "223456789012345678",
    summary: { cause: ["원인이에요."], process: ["확인했어요."], conclusion: ["해결했어요."] }
  });
  assert.match(content, /\*\*원인\*\*/);
  assert.match(content, /\*\*진행 과정\*\*/);
  assert.match(content, /\*\*결론 \/ 다음 작업\*\*/);
  assert.match(content, /https:\/\/discord.com\/channels\/123456789012345678\/223456789012345678/);
});

test("스레드 요약을 시작 메시지의 답글로 보내고 작성자에게 알림을 줘요", async () => {
  const requests = [];
  const interaction = {
    id: "123456789012345678",
    application_id: "223456789012345678",
    token: "interaction-token",
    type: 2,
    channel_id: "323456789012345678",
    data: { name: "스레드-정리" }
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/interactions/")) return { ok: true, status: 204 };
    if (url.endsWith("/channels/323456789012345678")) {
      return { ok: true, status: 200, json: async () => ({ id: "323456789012345678", type: 11, parent_id: "423456789012345678", guild_id: "523456789012345678" }) };
    }
    if (url.endsWith("/channels/423456789012345678")) {
      return { ok: true, status: 200, json: async () => ({ id: "423456789012345678", type: 0 }) };
    }
    if (url.includes("/channels/323456789012345678/messages?")) {
      return { ok: true, status: 200, json: async () => [{ id: "623456789012345678", timestamp: "2026-08-11T01:00:00Z", author: { id: "1", username: "client" }, content: "음성이 안 나와요.", mentions: [] }] };
    }
    if (url === "https://api.openai.com/v1/responses") {
      return { ok: true, status: 200, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ cause: ["오디오 출력 설정이 꺼져 있었어요."], process: ["설정을 확인했어요."], conclusion: ["설정을 켜고 재검증해요."] }) }] }] }) };
    }
    if (url.endsWith("/channels/423456789012345678/messages")) {
      return { ok: true, status: 200, json: async () => ({ id: "723456789012345678" }) };
    }
    if (url.includes("/webhooks/223456789012345678/")) {
      return { ok: true, status: 200, json: async () => ({ id: "823456789012345678" }) };
    }
    throw new Error(`예상하지 못한 요청: ${url}`);
  };

  assert.equal(await handleThreadSummaryInteraction({
    interaction,
    token: "discord-token",
    openAIKey: "openai-key",
    botUserId: "999",
    fetchImpl
  }), true);

  const posted = requests.find((request) => request.url.endsWith("/channels/423456789012345678/messages"));
  assert.equal(posted.body.message_reference.message_id, "323456789012345678");
  assert.deepEqual(posted.body.allowed_mentions, { parse: [], replied_user: true });
  assert.match(posted.body.content, /오디오 출력 설정이 꺼져 있었어요/);
});
