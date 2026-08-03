import { loadConfig } from "./config.mjs";
import { personalNotificationPayload, sendDiscordMessage, teamSummaryPayload } from "./discord.mjs";
import { collectSnapshot } from "./github.mjs";
import { evaluateAlerts } from "./policy.mjs";
import { loadState, saveState, selectUnsentAlerts, updateObservedBranches } from "./state.mjs";

const HOUR = 60 * 60 * 1_000;
const MAX_SUMMARY_ITEMS = 10;

function elapsedHours(now, value) {
  return Math.floor((now - new Date(value)) / HOUR);
}

function issueLink(issue) {
  return `[${issue.repository}#${issue.number}: ${issue.title}](<${issue.url}>)`;
}

function pullRequestLink(pr) {
  return `[${pr.repository}#${pr.number}: ${pr.title}](<${pr.url}>)`;
}

function listSection(title, items) {
  if (items.length === 0) return `**${title}**\n- 없어요.`;
  const visible = items.slice(0, MAX_SUMMARY_ITEMS);
  const omitted = items.length - visible.length;
  return [
    `**${title} (${items.length}개)**`,
    ...visible.map((item) => `- ${item}`),
    ...(omitted > 0 ? [`- 외 ${omitted}개는 GitHub에서 확인해 주세요.`] : [])
  ].join("\n");
}

export function dailySummary({ now, issues, pullRequests, alerts }) {
  const agedIssues = issues
    .filter((issue) => issue.assignedAt && elapsedHours(now, issue.assignedAt) >= 24)
    .sort((left, right) => new Date(left.assignedAt) - new Date(right.assignedAt));
  const criticalIssues = agedIssues.filter((issue) => elapsedHours(now, issue.assignedAt) >= 48);
  const warningIssues = agedIssues.filter((issue) => elapsedHours(now, issue.assignedAt) < 48);
  const openPrs = pullRequests.filter((pr) => !pr.isDraft);

  return [
    "오늘 확인할 협업 작업이에요.",
    listSection("처리할 Open PR", openPrs.map(pullRequestLink)),
    listSection("48시간 이상 이슈 · 심각", criticalIssues.map((issue) => `${issueLink(issue)} — 할당 후 ${elapsedHours(now, issue.assignedAt)}시간`)),
    listSection("24~48시간 이슈 · 경고", warningIssues.map((issue) => `${issueLink(issue)} — 할당 후 ${elapsedHours(now, issue.assignedAt)}시간`)),
    listSection("현재 막힌 작업", alerts.map((alert) => `[${alert.message}](<${alert.url}>)`))
  ].join("\n\n");
}

export async function run({ env = process.env, now = new Date(), dryRun = false, summary = false, fetchImpl } = {}) {
  const config = loadConfig(env);
  const state = await loadState(config.statePath);
  const snapshot = await collectSnapshot({ token: config.githubToken, repositories: config.repositories, fetchImpl });
  updateObservedBranches(state, snapshot.branches, now);
  const activeAlerts = evaluateAlerts({ now, ...snapshot });
  for (const github of activeAlerts.flatMap((item) => item.recipients).filter((github) => !config.recipients.has(github))) {
    console.warn(`Discord 수신자 설정이 없어 ${github} 알림을 보류해요.`);
  }
  const recipientAlerts = activeAlerts.flatMap((item) => item.recipients
    .filter((github) => config.recipients.has(github))
    .map((github) => ({ ...item, key: `${item.key}:${github}`, recipients: [github] })));
  const alerts = selectUnsentAlerts(state, recipientAlerts);

  for (const item of alerts) {
    for (const github of item.recipients) {
      const recipient = config.recipients.get(github);
      const message = `${item.message}\n${item.url}`;
      if (dryRun) {
        console.log(`[DRY RUN] ${github}: ${message}`);
      } else {
        await sendDiscordMessage({
          token: config.discordToken,
          channelId: recipient.channelId,
          payload: personalNotificationPayload({ userId: recipient.userId, message }),
          fetchImpl
        });
      }
    }
  }

  if (summary) {
    if (!config.teamRoleId) throw new Error("일일 팀 요약에는 DISCORD_TEAM_ROLE_ID 환경변수가 필요해요.");
    const teamChannelId = env.DISCORD_TEAM_CHANNEL_ID;
    if (!teamChannelId) throw new Error("일일 팀 요약에는 DISCORD_TEAM_CHANNEL_ID 환경변수가 필요해요.");
    const message = dailySummary({ now, ...snapshot, alerts: activeAlerts });
    if (dryRun) console.log(`[DRY RUN] team summary: ${message}`);
    else await sendDiscordMessage({
      token: config.discordToken,
      channelId: teamChannelId,
      payload: teamSummaryPayload({ roleId: config.teamRoleId, message }),
      fetchImpl
    });
  }

  if (!dryRun) await saveState(config.statePath, state);
  return { activeAlerts, alerts, snapshot };
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const summary = process.argv.includes("--summary");
  await run({ dryRun, summary });
}
