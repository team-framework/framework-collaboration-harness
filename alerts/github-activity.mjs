const ACTIONS = {
  archived: "보관했어요",
  assigned: "담당자를 지정했어요",
  closed: "종료했어요",
  converted_to_draft: "Draft로 전환했어요",
  created: "작성했어요",
  deleted: "삭제했어요",
  demilestoned: "마일스톤을 제거했어요",
  dismissed: "취소했어요",
  edited: "수정했어요",
  labeled: "라벨을 추가했어요",
  locked: "대화를 잠갔어요",
  milestoned: "마일스톤을 지정했어요",
  opened: "열었어요",
  pinned: "고정했어요",
  ready_for_review: "리뷰 가능한 상태로 전환했어요",
  reopened: "다시 열었어요",
  renamed: "이름을 변경했어요",
  review_request_removed: "리뷰 요청을 취소했어요",
  review_requested: "리뷰를 요청했어요",
  submitted: "제출했어요",
  synchronize: "새 커밋을 반영했어요",
  transferred: "이전했어요",
  unassigned: "담당자를 해제했어요",
  unlabeled: "라벨을 제거했어요",
  unlocked: "대화 잠금을 해제했어요",
  unarchived: "보관을 해제했어요",
  unpinned: "고정을 해제했어요",
  unresolved: "리뷰 스레드를 다시 열었어요",
  resolved: "리뷰 스레드를 해결했어요"
};

const REVIEW_STATES = {
  approved: "승인 리뷰를 남겼어요",
  changes_requested: "변경을 요청했어요",
  commented: "리뷰 의견을 남겼어요",
  dismissed: "리뷰를 취소했어요",
  pending: "리뷰를 작성 중이에요"
};

const STATUS_LABELS = {
  completed: "완료",
  failure: "실패",
  in_progress: "실행 중",
  pending: "대기 중",
  queued: "대기열",
  requested: "요청됨",
  skipped: "건너뜀",
  success: "성공"
};

function clean(value) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

function truncate(value, maximum) {
  const text = clean(value);
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function quote(value) {
  const text = truncate(value, 700);
  return text ? text.split("\n").slice(0, 8).map((line) => `> ${line || " "}`).join("\n") : null;
}

function actorName(payload) {
  return clean(payload.sender?.login || payload.pusher?.name || "github") || "github";
}

function pullRequestName(pr) {
  return truncate(pr?.title, 155) || "제목 없는 PR";
}

function pullRequestSummary(payload, pr, wording) {
  return `${actorName(payload)} · PR: ${pullRequestName(pr)} · ${wording}`;
}

function pullRequestBodyDetail(pr) {
  const body = truncate(pr?.body, 2_000);
  return `**PR 본문**\n${body || "_본문이 없어요._"}`;
}

function quotedDetail(label, value) {
  const body = quote(value);
  return body ? `**${label}**\n${body}` : null;
}

function pullRequestReviewDetail(payload) {
  const review = payload.review;
  const state = clean(review?.state).toLowerCase();
  if (payload.action === "dismissed" || state === "approved") return null;
  const content = quote(review?.body) || "_작성된 리뷰 내용이 없어요._";
  const label = state === "changes_requested" ? "변경 요청 내용" : "리뷰 내용";
  return `**${label}**\n${content}`;
}

function action(payload) {
  return ACTIONS[payload.action] || `${clean(payload.action) || "unknown"} 활동을 수행했어요`;
}

function repoUrl(payload) {
  return payload.repository?.html_url || (payload.repository?.full_name ? `https://github.com/${payload.repository.full_name}` : "https://github.com");
}

function commitUrl(payload, sha) {
  return sha && payload.repository?.html_url ? `${payload.repository.html_url}/commit/${sha}` : repoUrl(payload);
}

function details(...values) {
  return values.filter(Boolean).join("\n");
}

function contextualIssueDetail(payload) {
  if (payload.assignee?.login) return `대상: \`${payload.assignee.login}\``;
  if (payload.label?.name) return `라벨: \`${payload.label.name}\``;
  if (payload.milestone?.title) return `마일스톤: ${payload.milestone.title}`;
  return null;
}

function contextualPullRequestDetail(payload) {
  if (payload.requested_reviewer?.login) return `리뷰어: \`${payload.requested_reviewer.login}\``;
  if (payload.requested_team?.name) return `리뷰 팀: \`${payload.requested_team.name}\``;
  return contextualIssueDetail(payload);
}

function pushActivity(payload) {
  const ref = clean(payload.ref).replace(/^refs\/(heads|tags)\//, "");
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const visible = commits.slice(0, 5).map((commit) => `- \`${clean(commit.id).slice(0, 7)}\` ${truncate(commit.message?.split("\n")[0], 120)}`);
  if (commits.length > visible.length) visible.push(`- 외 ${commits.length - visible.length}개 커밋`);
  return {
    summary: `\`${ref}\`에 ${commits.length}개 커밋을 push했어요`,
    detail: visible.join("\n") || (payload.deleted ? "브랜치가 삭제됐어요." : "변경된 커밋 정보가 없어요."),
    url: payload.compare || commitUrl(payload, payload.after)
  };
}

function issueActivity(payload) {
  const issue = payload.issue;
  return {
    summary: `Issue #${issue.number}을(를) ${action(payload)}`,
    detail: details(`**${truncate(issue.title, 240)}**`, contextualIssueDetail(payload)),
    url: issue.html_url
  };
}

function issueCommentActivity(payload) {
  const issue = payload.issue;
  const comment = payload.comment;
  if (issue.pull_request) {
    return {
      summary: pullRequestSummary(payload, issue, `일반 댓글을 ${action(payload)}`),
      detail: details(pullRequestBodyDetail(issue), payload.action === "deleted" ? null : quotedDetail("일반 댓글", comment.body)),
      url: comment.html_url || issue.html_url
    };
  }
  return {
    summary: `Issue #${issue.number}의 일반 댓글을 ${action(payload)}`,
    detail: details(`**${truncate(issue.title, 240)}**`, payload.action === "deleted" ? null : quote(comment.body)),
    url: comment.html_url || issue.html_url
  };
}

function pullRequestActivity(payload) {
  const pr = payload.pull_request;
  let wording = action(payload);
  if (payload.action === "closed" && pr.merged) wording = "병합했어요";
  return {
    summary: pullRequestSummary(payload, pr, wording),
    detail: details(pullRequestBodyDetail(pr), contextualPullRequestDetail(payload), payload.action === "synchronize" ? `커밋: \`${clean(payload.before).slice(0, 7)}\` → \`${clean(payload.after).slice(0, 7)}\`` : null),
    url: pr.html_url
  };
}

function pullRequestReviewActivity(payload) {
  const pr = payload.pull_request;
  const review = payload.review;
  const wording = payload.action === "submitted"
    ? REVIEW_STATES[clean(review.state).toLowerCase()] || "리뷰를 제출했어요"
    : action(payload);
  return {
    summary: pullRequestSummary(payload, pr, wording),
    detail: pullRequestReviewDetail(payload),
    url: review.html_url || pr.html_url
  };
}

function pullRequestReviewCommentActivity(payload) {
  const pr = payload.pull_request;
  const comment = payload.comment;
  const line = comment.line || comment.original_line;
  return {
    summary: pullRequestSummary(payload, pr, `코드 라인 댓글을 ${action(payload)}`),
    detail: details(comment.path ? `파일: \`${truncate(comment.path, 180)}${line ? `:${line}` : ""}\`` : null, payload.action === "deleted" ? null : quotedDetail("코드 라인 댓글", comment.body)),
    url: comment.html_url || pr.html_url
  };
}

function pullRequestReviewThreadActivity(payload) {
  const pr = payload.pull_request;
  const firstComment = payload.thread?.comments?.[0];
  const line = firstComment?.line || firstComment?.original_line;
  return {
    summary: pullRequestSummary(payload, pr, action(payload)),
    detail: firstComment?.path ? `파일: \`${truncate(firstComment.path, 180)}${line ? `:${line}` : ""}\`` : null,
    url: firstComment?.html_url || pr.html_url
  };
}

function checkRunActivity(payload) {
  const run = payload.check_run;
  const result = run.conclusion || run.status;
  return {
    summary: `Check \`${truncate(run.name, 140)}\` 상태가 ${STATUS_LABELS[result] || clean(result)}이에요`,
    detail: run.output?.title ? truncate(run.output.title, 500) : null,
    url: run.html_url || commitUrl(payload, run.head_sha)
  };
}

function checkSuiteActivity(payload) {
  const suite = payload.check_suite;
  const result = suite.conclusion || suite.status;
  return {
    summary: `Check suite 상태가 ${STATUS_LABELS[result] || clean(result)}이에요`,
    detail: suite.app?.name ? `앱: ${suite.app.name}` : null,
    url: commitUrl(payload, suite.head_sha)
  };
}

function workflowActivity(payload, key, label) {
  const workflow = payload[key];
  const result = workflow.conclusion || workflow.status;
  return {
    summary: `${label} \`${truncate(workflow.name, 140)}\` 상태가 ${STATUS_LABELS[result] || clean(result)}이에요`,
    detail: workflow.head_branch ? `브랜치: \`${workflow.head_branch}\`` : null,
    url: workflow.html_url || repoUrl(payload)
  };
}

function discussionActivity(payload) {
  const discussion = payload.discussion;
  return {
    summary: `Discussion #${discussion.number}을(를) ${action(payload)}`,
    detail: `**${truncate(discussion.title, 240)}**`,
    url: discussion.html_url
  };
}

function discussionCommentActivity(payload) {
  const discussion = payload.discussion;
  const comment = payload.comment;
  return {
    summary: `Discussion #${discussion.number}의 댓글을 ${action(payload)}`,
    detail: details(`**${truncate(discussion.title, 240)}**`, payload.action === "deleted" ? null : quote(comment.body)),
    url: comment.html_url || discussion.html_url
  };
}

function deploymentActivity(payload) {
  const deployment = payload.deployment;
  return {
    summary: `배포 \`${truncate(deployment.environment || deployment.task, 140)}\`를 생성했어요`,
    detail: deployment.ref ? `ref: \`${truncate(deployment.ref, 160)}\`` : null,
    url: repoUrl(payload)
  };
}

function deploymentStatusActivity(payload) {
  const status = payload.deployment_status;
  const deployment = payload.deployment;
  return {
    summary: `배포 \`${truncate(deployment.environment || deployment.task, 140)}\` 상태가 ${STATUS_LABELS[status.state] || clean(status.state)}이에요`,
    detail: status.description ? truncate(status.description, 500) : null,
    url: status.environment_url || status.target_url || repoUrl(payload)
  };
}

function releaseActivity(payload) {
  const release = payload.release;
  return {
    summary: `Release \`${truncate(release.tag_name, 140)}\`을(를) ${action(payload)}`,
    detail: release.name && release.name !== release.tag_name ? `**${truncate(release.name, 240)}**` : null,
    url: release.html_url || repoUrl(payload)
  };
}

function commitCommentActivity(payload) {
  const comment = payload.comment;
  return {
    summary: `커밋 \`${clean(comment.commit_id).slice(0, 7)}\`의 댓글을 ${action(payload)}`,
    detail: details(comment.path ? `파일: \`${truncate(comment.path, 180)}${comment.line ? `:${comment.line}` : ""}\`` : null, payload.action === "deleted" ? null : quote(comment.body)),
    url: comment.html_url || commitUrl(payload, comment.commit_id)
  };
}

function statusActivity(payload) {
  return {
    summary: `Commit status \`${truncate(payload.context, 140)}\`가 ${STATUS_LABELS[payload.state] || clean(payload.state)}이에요`,
    detail: payload.description ? truncate(payload.description, 500) : `커밋: \`${clean(payload.sha).slice(0, 7)}\``,
    url: payload.target_url || commitUrl(payload, payload.sha)
  };
}

function refActivity(payload) {
  const kind = payload.ref_type === "tag" ? "태그" : "브랜치";
  const wording = payload.action === "delete" ? "삭제했어요" : "생성했어요";
  return {
    summary: `${kind} \`${truncate(payload.ref, 180)}\`을(를) ${wording}`,
    detail: payload.master_branch ? `기준 브랜치: \`${payload.master_branch}\`` : null,
    url: payload.ref_type === "tag" ? `${repoUrl(payload)}/releases/tag/${encodeURIComponent(payload.ref)}` : `${repoUrl(payload)}/tree/${encodeURIComponent(payload.ref)}`
  };
}

function forkActivity(payload) {
  const fork = payload.forkee;
  return {
    summary: fork?.full_name ? `저장소를 \`${truncate(fork.full_name, 180)}\`로 fork했어요` : "저장소를 fork했어요",
    detail: null,
    url: fork?.html_url || repoUrl(payload)
  };
}

function wikiActivity(payload) {
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const visible = pages.slice(0, 5).map((page) => `- ${truncate(page.page_name || page.title, 180)} (${clean(page.action) || "changed"})`);
  if (pages.length > visible.length) visible.push(`- 외 ${pages.length - visible.length}개 페이지`);
  return {
    summary: `Wiki 페이지 ${pages.length}개를 변경했어요`,
    detail: visible.join("\n") || null,
    url: pages[0]?.html_url || repoUrl(payload)
  };
}

function labelActivity(payload) {
  const label = payload.label;
  return {
    summary: `라벨 \`${truncate(label?.name, 160)}\`을(를) ${action(payload)}`,
    detail: label?.description ? truncate(label.description, 500) : null,
    url: repoUrl(payload)
  };
}

function milestoneActivity(payload) {
  const milestone = payload.milestone;
  return {
    summary: `마일스톤 \`${truncate(milestone?.title, 180)}\`을(를) ${action(payload)}`,
    detail: milestone?.description ? truncate(milestone.description, 500) : null,
    url: milestone?.html_url || repoUrl(payload)
  };
}

function repositoryActivity(payload) {
  const previousName = payload.changes?.repository?.name?.from || payload.changes?.name?.from;
  return {
    summary: `저장소를 ${action(payload)}`,
    detail: previousName ? `이전 이름: \`${truncate(previousName, 180)}\`` : null,
    url: repoUrl(payload)
  };
}

function issueRelationActivity(payload, label) {
  const issue = payload.issue;
  const related = payload.sub_issue || payload.blocking_issue;
  return {
    summary: issue?.number ? `Issue #${issue.number}의 ${label}을(를) ${action(payload)}` : `${label}을(를) ${action(payload)}`,
    detail: details(issue?.title ? `**${truncate(issue.title, 240)}**` : null, related?.number ? `연결 Issue: #${related.number} ${truncate(related.title, 200)}` : null),
    url: issue?.html_url || repoUrl(payload)
  };
}

function workflowDispatchActivity(payload) {
  const workflow = payload.workflow;
  return {
    summary: `Workflow${workflow?.name ? ` \`${truncate(workflow.name, 140)}\`` : ""} 수동 실행을 요청했어요`,
    detail: payload.ref ? `ref: \`${truncate(payload.ref, 160)}\`` : null,
    url: workflow?.html_url || repoUrl(payload)
  };
}

const FORMATTERS = {
  check_run: checkRunActivity,
  check_suite: checkSuiteActivity,
  commit_comment: commitCommentActivity,
  create: (payload) => refActivity({ ...payload, action: "create" }),
  delete: (payload) => refActivity({ ...payload, action: "delete" }),
  deployment: deploymentActivity,
  deployment_status: deploymentStatusActivity,
  discussion: discussionActivity,
  discussion_comment: discussionCommentActivity,
  fork: forkActivity,
  gollum: wikiActivity,
  issue_comment: issueCommentActivity,
  issue_dependencies: (payload) => issueRelationActivity(payload, "의존 관계"),
  issues: issueActivity,
  label: labelActivity,
  milestone: milestoneActivity,
  pull_request: pullRequestActivity,
  pull_request_review: pullRequestReviewActivity,
  pull_request_review_comment: pullRequestReviewCommentActivity,
  pull_request_review_thread: pullRequestReviewThreadActivity,
  push: pushActivity,
  release: releaseActivity,
  repository: repositoryActivity,
  status: statusActivity,
  sub_issues: (payload) => issueRelationActivity(payload, "하위 이슈"),
  workflow_dispatch: workflowDispatchActivity,
  workflow_job: (payload) => workflowActivity(payload, "workflow_job", "Workflow job"),
  workflow_run: (payload) => workflowActivity(payload, "workflow_run", "Workflow")
};

export function formatGitHubActivity(event, payload) {
  const repository = clean(payload.repository?.full_name);
  if (!repository) throw new Error("GitHub webhook payload에 repository.full_name이 필요해요.");
  const actor = actorName(payload);
  const formatted = FORMATTERS[event]?.(payload) || {
    summary: `\`${clean(event)}\` ${action(payload)}`,
    detail: null,
    url: repoUrl(payload)
  };

  return {
    repository,
    actor,
    event,
    summary: truncate(formatted.summary, 256),
    detail: truncate(formatted.detail, 3_500) || null,
    url: formatted.url || repoUrl(payload)
  };
}
