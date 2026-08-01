import { requireSnowflake } from "./discord.mjs";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요해요.`);
  return value;
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
  const repositories = required(env, "TARGET_REPOSITORIES")
    .split(",")
    .map((repository) => repository.trim())
    .filter(Boolean);
  if (repositories.some((repository) => !/^[^/]+\/[^/]+$/.test(repository))) {
    throw new Error("TARGET_REPOSITORIES는 owner/repository 형식이어야 해요.");
  }

  return {
    githubToken: required(env, "GITHUB_TOKEN"),
    discordToken: required(env, "DISCORD_BOT_TOKEN"),
    repositories,
    recipients: parseRecipients(required(env, "DISCORD_RECIPIENTS_JSON")),
    teamRoleId: env.DISCORD_TEAM_ROLE_ID?.trim() || null,
    statePath: env.ALERT_STATE_PATH?.trim() || ".runtime/alert-state.json"
  };
}
