import { requireSnowflake } from "./discord.mjs";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요해요.`);
  return value;
}

function parseRepositoryList(value, name) {
  const repositories = required({ [name]: value }, name)
    .split(",")
    .map((repository) => repository.trim())
    .filter(Boolean);
  if (repositories.some((repository) => !/^[^/]+\/[^/]+$/.test(repository))) {
    throw new Error(`${name}는 owner/repository 형식이어야 해요.`);
  }
  return repositories;
}

function parseRecipients(value) {
  let recipients;
  try {
    recipients = JSON.parse(value);
  } catch {
    throw new Error("DISCORD_RECIPIENTS_JSON은 JSON 배열이어야 해요.");
  }
  if (!Array.isArray(recipients)) throw new Error("DISCORD_RECIPIENTS_JSON은 JSON 배열이어야 해요.");

  const byGithub = new Map();
  for (const recipient of recipients) {
    const github = recipient?.github?.trim();
    if (!github) throw new Error("각 Discord 수신자에 GitHub 아이디가 필요해요.");
    if (byGithub.has(github)) throw new Error(`GitHub 수신자 ${github}이(가) 중복됐어요.`);
    byGithub.set(github, {
      github,
      userId: requireSnowflake(recipient.userId, `${github}.userId`),
      channelId: requireSnowflake(recipient.channelId, `${github}.channelId`)
    });
  }
  return byGithub;
}

export function loadConfig(env = process.env) {
  const repositories = parseRepositoryList(env.TARGET_REPOSITORIES, "TARGET_REPOSITORIES");

  return {
    githubToken: required(env, "GITHUB_TOKEN"),
    discordToken: required(env, "DISCORD_BOT_TOKEN"),
    repositories,
    recipients: parseRecipients(required(env, "DISCORD_RECIPIENTS_JSON")),
    teamRoleId: env.DISCORD_TEAM_ROLE_ID?.trim() || null,
    statePath: env.ALERT_STATE_PATH?.trim() || ".runtime/alert-state.json"
  };
}


function parseActivityChannels(value, repositories) {
  let channels;
  try {
    channels = JSON.parse(value);
  } catch {
    throw new Error("DISCORD_ACTIVITY_CHANNELS_JSON은 JSON 객체여야 해요.");
  }
  if (!channels || Array.isArray(channels) || typeof channels !== "object") {
    throw new Error("DISCORD_ACTIVITY_CHANNELS_JSON은 JSON 객체여야 해요.");
  }

  const byRepository = new Map();
  for (const repository of repositories) {
    byRepository.set(repository, requireSnowflake(channels[repository], `${repository}.channelId`));
  }
  return byRepository;
}

function parsePort(value) {
  const port = Number(value || 3006);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GITHUB_WEBHOOK_PORT는 1~65535 사이의 포트여야 해요.");
  }
  return port;
}

export function loadActivityConfig(env = process.env) {
  const repositories = parseRepositoryList(env.GITHUB_ACTIVITY_REPOSITORIES, "GITHUB_ACTIVITY_REPOSITORIES");
  const webhookPath = env.GITHUB_WEBHOOK_PATH?.trim() || "/github/webhooks";
  if (!webhookPath.startsWith("/") || webhookPath.includes("?")) {
    throw new Error("GITHUB_WEBHOOK_PATH는 /로 시작하는 경로여야 해요.");
  }

  return {
    githubToken: env.GITHUB_TOKEN?.trim() || null,
    discordToken: required(env, "DISCORD_BOT_TOKEN"),
    repositories,
    channels: parseActivityChannels(required(env, "DISCORD_ACTIVITY_CHANNELS_JSON"), repositories),
    webhookSecret: required(env, "GITHUB_WEBHOOK_SECRET"),
    webhookHost: env.GITHUB_WEBHOOK_HOST?.trim() || "0.0.0.0",
    webhookPort: parsePort(env.GITHUB_WEBHOOK_PORT),
    webhookPath,
    statePath: env.GITHUB_WEBHOOK_STATE_PATH?.trim() || ".runtime/github-webhook-state.json"
  };
}
