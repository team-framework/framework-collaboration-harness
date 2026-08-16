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
    description: "현재 스레드를 시간 순 타임라인으로 정리해요.",
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
  return `${author}: ${content}`;
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
        "당신은 한국어 개발 협업 스레드를 회의록처럼 정리하는 기록자예요.",
        "목표는 대화를 단순히 요약하는 것이 아니라, 논의가 어떤 주제에서 시작되었고 어떤 의견과 근거가 오갔으며 어떤 과정을 거쳐 합의 또는 결정에 도달했는지를 기록하는 것이에요.",
        "원본 스레드를 읽지 않은 사람도 정리 결과만 보고 논의의 맥락과 최종 결론을 이해할 수 있어야 해요.",
        "대화에 명시된 사실만 사용하고, 대화에 없는 사실이나 의도는 추론하지 마세요.",
        "일반적인 개발 관행이나 상식에 따라 내용을 보완하지 마세요.",
        "대화의 흐름은 주제 제기, 의견 제시, 근거, 다른 의견이나 반론, 추가 논의, 합의 또는 결정의 순서로 보존하세요.",
        "모든 메시지를 나열하지 말고, 서로 연결되는 발언은 하나의 논의 흐름으로 묶어서 자연스럽게 서술하세요.",
        "단순한 인사, 반복적인 발언, 논의의 맥락을 이해하는 데 필요하지 않은 내용은 제외하세요.",
        "제안, 논의, 결정, 실행, 완료를 구분하세요.",
        "의견이나 제안만으로 결정되었다고 판단하지 마세요.",
        "결정되었다는 사실만으로 실행되었다고 판단하지 마세요.",
        "실행되었다는 사실만으로 완료되었다고 판단하지 마세요.",
        "'제안합니다', '좋다고 생각합니다', '하면 좋겠습니다', '어떨까요' 등의 표현은 제안이나 의견으로 취급하세요.",
        "'결정하겠습니다', '이것으로 하겠습니다', '이걸로 결정했습니다' 등 명시적인 결정 표현이 있을 때만 결정으로 취급하세요.",
        "명시적인 동의가 최종 결정에 연결되어 있다면 합의가 이루어진 것으로 기록할 수 있어요.",
        "결정의 근거가 대화에서 제시되었다면 그 근거를 논의 흐름에 포함하세요.",
        "결정의 근거가 명시되지 않았다면 임의로 이유를 만들어내지 마세요.",
        "대화 중 기존 내용이 명시적으로 정정되었다면 정정된 내용을 기준으로 정리하세요.",
        "서로 다른 의견이나 정보가 존재하지만 정정이나 합의가 없다면 어느 한쪽을 사실로 확정하지 마세요.",
        "확인되지 않은 내용은 '확인되지 않음'으로 표시하세요.",
        "대화에 없는 후속 작업, 일정, 담당자, 목표, 원인, 추가 계획을 생성하지 마세요.",
        "결정된 내용을 바탕으로 일반적으로 필요할 것 같은 업무를 다음 작업으로 추천하지 마세요.",
        "스레드에서 언급되지 않은 업무를 결론에 추가하지 마세요.",
        "three_line_summary의 problem, action, status는 각각 문제 상황, 논의 과정, 현재 상태 또는 결론을 한 줄로 작성하세요.",
        "각 항목은 50자 이내로 작성하세요.",
        "three_line_summary는 논의의 핵심을 압축해서 보여주되, 대화에 없는 내용을 추가하지 마세요.",
        "discussion_flow는 시간별 메시지 목록이나 타임라인으로 작성하지 마세요.",
        "discussion_flow는 대화의 시간 순서를 유지하면서 주요 의견, 근거, 반론, 합의 및 결정이 어떻게 이어졌는지를 하나의 자연스러운 회의록 문단으로 작성하세요.",
        "discussion_flow에는 논의의 흐름을 이해하는 데 필요한 내용만 포함하세요.",
        "conclusion에는 최종 결정, 결정의 주요 근거, 현재 실행 또는 완료 상태만 기록하세요.",
        "결정되지 않았다면 '결정되지 않음'이라고 기록하세요.",
        "실행 여부가 확인되지 않았다면 '실행 여부 확인되지 않음'이라고 기록하세요.",
        "완료 여부가 확인되지 않았다면 완료로 표현하지 마세요.",
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
              three_line_summary: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  action: { type: "string" },
                  status: { type: "string" }
                },
                required: ["problem", "action", "status"],
                additionalProperties: false
              },
              discussion_flow: {
                type: "string"
              },
              conclusion: { type: "array", items: { type: "string" } }
            },
            required: ["three_line_summary", "discussion_flow", "conclusion"],
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

function headingSection(title, items) {
  const normalized = Array.isArray(items) && items.length > 0 ? items : ["확인된 내용이 없어요."];
  return [`## ${title}`, ...normalized.slice(0, 6).map((item) => `- ${String(item).trim()}`)].join("\n");
}

function threeLineSummarySection(summary) {
  const normalized = summary || {};
  return [
    "## 3줄 요약",
    `### 문제 상황\n${String(normalized.problem || "확인된 내용이 없어요.").trim()}`,
    `### 과정\n${String(normalized.action || "확인된 내용이 없어요.").trim()}`,
    `### 상태 / 결론\n${String(normalized.status || "확인된 내용이 없어요.").trim()}`
  ].join("\n");
}

function discussionFlowSection(flow) {
  return [
    "## 논의 흐름",
    String(flow || "확인된 내용이 없어요.").trim()
  ].join("\n");
}

export function formatThreadSummary({ summary, guildId, threadId, threadName, ownerMentionId }) {
  const content = [
    `# ${required(threadName, "threadName")} 스레드 정리`,
    ...(ownerMentionId ? [`스레드 작성자: <@${ownerMentionId}>`] : []),
    threeLineSummarySection(summary.three_line_summary),
    discussionFlowSection(summary.discussion_flow),
    headingSection("결론", summary.conclusion),
    `-# [스레드 열기](https://discord.com/channels/${guildId}/${threadId})`
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
