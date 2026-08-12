import {
  discordApiRequest,
  editInteractionResponse,
  sendDiscordMessage,
  sendInteractionCallback
} from "./discord.mjs";

export const THREAD_SUMMARY_COMMAND = "스레드-정리";

const THREAD_TYPES = new Set([10, 11, 12]);
const MESSAGE_PARENT_TYPES = new Set([0, 5]);
const PRIVATE_THREAD_TYPE = 12;
const THREAD_CREATED_MESSAGE_TYPE = 18;
const MAX_MESSAGES = 500;
const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_DISCORD_CONTENT = 2_000;
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";

function required(value, name) {
  const text = value?.trim();
  if (!text) throw new Error(`${name} 환경변수가 필요해요.`);
  return text;
}

export function threadSummaryCommandDefinition() {
  return {
    name: THREAD_SUMMARY_COMMAND,
    description: "현재 스레드의 원인, 진행 과정, 결론을 정리해요.",
    type: 1,
    dm_permission: false
  };
}

export async function registerThreadSummaryCommand({ token, applicationId, guildId, fetchImpl = fetch }) {
  const path = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;
  return discordApiRequest({
    token,
    path,
    method: "POST",
    body: threadSummaryCommandDefinition(),
    fetchImpl
  });
}

export async function discoverDiscordContext({ token, teamChannelId, fetchImpl = fetch }) {
  const application = await discordApiRequest({ token, path: "/oauth2/applications/@me", fetchImpl });
  if (!teamChannelId) return { applicationId: application.id, guildId: null };
  const channel = await discordApiRequest({ token, path: `/channels/${teamChannelId}`, fetchImpl });
  return { applicationId: application.id, guildId: channel.guild_id || null };
}

export async function fetchThreadMessages({ token, channelId, fetchImpl = fetch, maxMessages = MAX_MESSAGES, pageSize = 100 }) {
  const messages = [];
  let before = null;
  while (messages.length < maxMessages) {
    const limit = Math.min(pageSize, maxMessages - messages.length);
    const query = new URLSearchParams({ limit: String(limit) });
    if (before) query.set("before", before);
    const page = await discordApiRequest({
      token,
      path: `/channels/${channelId}/messages?${query}`,
      fetchImpl
    });
    messages.push(...page);
    if (page.length < limit) break;
    before = page.at(-1)?.id;
    if (!before) break;
  }
  return messages.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function participantName(authorId, participants) {
  const id = authorId || "unknown";
  if (!participants.has(id)) participants.set(id, `참여자 ${participants.size + 1}`);
  return participants.get(id);
}

function replaceMentions(content, participants) {
  return content.replace(/<@!?(\d+)>/g, (_match, id) => `@${participantName(id, participants)}`);
}

function messageLine(message, botUserId, participants) {
  if (message.author?.id === botUserId) return null;
  const source = message.content?.trim()
    ? message
    : message.referenced_message?.content?.trim()
      ? message.referenced_message
      : null;
  if (!source) return null;
  const author = participantName(source.author?.id, participants);
  const content = replaceMentions(source.content.trim(), participants);
  const timestamp = new Date(source.timestamp || message.timestamp).toISOString();
  return `[${timestamp}] ${author}: ${content}`;
}

export function buildThreadTranscript({ messages, botUserId, maxChars = MAX_TRANSCRIPT_CHARS }) {
  const participants = new Map();
  const lines = [...messages]
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
    .map((message) => messageLine(message, botUserId, participants))
    .filter(Boolean);
  if (lines.length === 0) throw new Error("요약할 텍스트 메시지가 없어요. Message Content Intent와 채널 권한을 확인해 주세요.");
  const transcript = lines.join("\n");
  if (transcript.length <= maxChars) return transcript;

  const headLimit = Math.floor(maxChars * 0.35);
  const tailLimit = maxChars - headLimit;
  return `${transcript.slice(0, headLimit)}\n[중간 메시지는 길이 제한으로 생략했어요.]\n${transcript.slice(-tailLimit)}`;
}

function outputText(response) {
  return response.output
    ?.flatMap((item) => item.content || [])
    .find((content) => content.type === "output_text")
    ?.text;
}

export async function summarizeThread({ apiKey, model = DEFAULT_OPENAI_MODEL, transcript, fetchImpl = fetch }) {
  const reasoning = /^gpt-5-nano(?:-|$)/.test(model) ? { effort: "minimal" } : undefined;
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required(apiKey, "OPENAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning,
      instructions: [
        "당신은 한국어 개발 협업 스레드를 정리하는 도우미예요.",
        "대화에 명시된 사실만 사용하고 추측하지 마세요.",
        "원인이 확정되지 않았다면 확정되지 않았다고 적으세요.",
        "진행 과정은 중요한 확인과 시도만 시간 순서로 적으세요.",
        "결론에는 결정된 내용, 해결 여부, 남은 다음 작업을 적으세요.",
        "사람 이름이나 계정명은 꼭 필요한 경우가 아니면 제외하세요."
      ].join(" "),
      input: `다음 Discord 스레드를 정리해 주세요.\n\n${transcript}`,
      max_output_tokens: 1_200,
      text: {
        format: {
          type: "json_schema",
          name: "thread_summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              cause: { type: "array", items: { type: "string" } },
              process: { type: "array", items: { type: "string" } },
              conclusion: { type: "array", items: { type: "string" } }
            },
            required: ["cause", "process", "conclusion"],
            additionalProperties: false
          }
        }
      }
    })
  });
  if (!response.ok) throw new Error(`AI 스레드 요약에 실패했어요: ${response.status}`);
  const result = await response.json();
  const text = outputText(result);
  if (!text) throw new Error("AI가 스레드 요약 결과를 반환하지 않았어요.");
  return JSON.parse(text);
}

function section(title, items) {
  const normalized = Array.isArray(items) && items.length > 0 ? items : ["확인된 내용이 없어요."];
  return [`**${title}**`, ...normalized.slice(0, 6).map((item) => `- ${String(item).trim()}`)].join("\n");
}

export function formatThreadSummary({ summary, guildId, threadId, threadName, ownerMentionId }) {
  const content = [
    `**${required(threadName, "threadName")}** 스레드를 정리했어요.`,
    ...(ownerMentionId ? [`스레드 작성자: <@${ownerMentionId}>`] : []),
    section("원인", summary.cause),
    section("진행 과정", summary.process),
    section("결론 / 다음 작업", summary.conclusion),
    `[스레드 열기](https://discord.com/channels/${guildId}/${threadId})`
  ].join("\n\n");
  if (content.length <= MAX_DISCORD_CONTENT) return content;
  return `${content.slice(0, MAX_DISCORD_CONTENT - 20)}\n…(일부 생략했어요.)`;
}

function summaryMessagePayload({ thread, starterMessage, summary }) {
  const repliesToStarter = starterMessage && starterMessage.type !== THREAD_CREATED_MESSAGE_TYPE;
  const ownerMentionId = repliesToStarter ? null : thread.owner_id;
  const payload = {
    content: formatThreadSummary({
      summary,
      guildId: thread.guild_id,
      threadId: thread.id,
      threadName: thread.name,
      ownerMentionId
    }),
    allowed_mentions: repliesToStarter
      ? { parse: [], replied_user: true }
      : { parse: [], users: ownerMentionId ? [ownerMentionId] : [] }
  };
  if (repliesToStarter) {
    payload.message_reference = {
      type: 0,
      message_id: starterMessage.id,
      channel_id: thread.parent_id,
      guild_id: thread.guild_id,
      fail_if_not_exists: true
    };
  }
  return payload;
}

async function finishInteraction({ interaction, content, fetchImpl }) {
  return editInteractionResponse({
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
    content,
    fetchImpl
  });
}

export async function handleThreadSummaryInteraction({
  interaction,
  token,
  openAIKey,
  model,
  botUserId,
  fetchImpl = fetch,
  logger = console
}) {
  if (interaction.type !== 2 || interaction.data?.name !== THREAD_SUMMARY_COMMAND) return false;

  await sendInteractionCallback({
    interactionId: interaction.id,
    interactionToken: interaction.token,
    payload: { type: 5, data: { flags: 64 } },
    fetchImpl
  });

  try {
    const thread = await discordApiRequest({ token, path: `/channels/${interaction.channel_id}`, fetchImpl });
    if (!THREAD_TYPES.has(thread.type) || !thread.parent_id) {
      await finishInteraction({ interaction, content: "이 명령은 Discord 스레드 안에서만 사용할 수 있어요.", fetchImpl });
      return true;
    }

    const parent = await discordApiRequest({ token, path: `/channels/${thread.parent_id}`, fetchImpl });
    if (!MESSAGE_PARENT_TYPES.has(parent.type)) {
      await finishInteraction({ interaction, content: "포럼·미디어 게시물은 원본 채널에 답글을 남길 수 없어요.", fetchImpl });
      return true;
    }

    const starterMessage = thread.type === PRIVATE_THREAD_TYPE
      ? null
      : await discordApiRequest({
        token,
        path: `/channels/${thread.parent_id}/messages/${thread.id}`,
        fetchImpl
      });
    const messages = await fetchThreadMessages({ token, channelId: thread.id, fetchImpl });
    const transcript = buildThreadTranscript({ messages, botUserId });
    const summary = await summarizeThread({ apiKey: openAIKey, model, transcript, fetchImpl });
    const message = await sendDiscordMessage({
      token,
      channelId: thread.parent_id,
      payload: summaryMessagePayload({ thread, starterMessage, summary }),
      fetchImpl
    });
    const resultUrl = `https://discord.com/channels/${thread.guild_id}/${thread.parent_id}/${message.id}`;
    await finishInteraction({ interaction, content: `원본 채널에 [스레드 정리](${resultUrl})를 남겼어요.`, fetchImpl });
  } catch (error) {
    logger.error(`스레드 정리에 실패했어요: ${error.message}`);
    await finishInteraction({ interaction, content: "스레드를 정리하지 못했어요. 봇 권한과 AI 설정을 확인해 주세요.", fetchImpl });
  }
  return true;
}
