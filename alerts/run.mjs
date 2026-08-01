import { loadConfig } from "./config.mjs";
import { personalNotificationPayload, sendDiscordMessage, teamSummaryPayload } from "./discord.mjs";
import { collectSnapshot } from "./github.mjs";
import { evaluateAlerts } from "./policy.mjs";
import { loadState, saveState, selectUnsentAlerts, updateObservedBranches } from "./state.mjs";

function dailySummary({ now, issues, pullRequests, alerts }) {
  const oldIssues = (hours) => issues.filter((issue) => issue.assignedAt && now - new Date(issue.assignedAt) >= hours * 60 * 60 * 1_000).length;
  const openPrs = pullRequests.filter((pr) => !pr.isDraft).length;
  return [
    "오늘 확인할 협업 작업이에요.",
    `- 처리할 Open PR: ${openPrs}개`,
    `- 24시간 넘은 이슈: ${oldIssues(24)}개`,
    `- 48시간 넘은 이슈: ${oldIssues(48)}개`,
    `- 현재 막힌 작업: ${alerts.length}개`
  ].join("\n");
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
