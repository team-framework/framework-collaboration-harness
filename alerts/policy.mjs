const HOUR = 60 * 60 * 1_000;

function date(value) {
  return value ? new Date(value) : null;
}

function olderThan(now, value, hours) {
  const at = date(value);
  return at && now - at >= hours * HOUR;
}

export function formatElapsed(now, value) {
  const elapsedHours = Math.max(0, Math.floor((now - new Date(value)) / HOUR));
  if (elapsedHours < 24) return `${elapsedHours}시간`;
  return `${Math.floor(elapsedHours / 24)}일 ${elapsedHours % 24}시간`;
}

function alert({ key, kind, recipients, url, message, severity = "normal" }) {
  return { key, kind, recipients: [...new Set(recipients)], url, message, severity };
}

export function evaluateAlerts({ now = new Date(), issues, branches, pullRequests }) {
  const alerts = [];
  const branchByIssue = new Map(branches.map((branch) => [`${branch.repository}#${branch.issueNumber}`, branch]));
  const pullRequestBranches = new Set(pullRequests.map((pr) => `${pr.repository}:${pr.headRef}`));

  for (const issue of issues) {
    const branch = branchByIssue.get(`${issue.repository}#${issue.number}`);
    if (!branch && issue.assignedAt && olderThan(now, issue.assignedAt, 5)) {
      alerts.push(alert({
        key: `issue-no-branch:${issue.repository}#${issue.number}:${issue.assignedAt}`,
        kind: "issue-no-branch",
        recipients: issue.assignees,
        url: issue.url,
        message: `이슈가 할당된 뒤 ${formatElapsed(now, issue.assignedAt)}째 연결된 브랜치가 없어요. 작업을 시작해 주세요.`
      }));
    }
  }

  for (const branch of branches) {
    const recipients = branch.assignees;
    if (branch.commitsAhead === 0 && branch.firstObservedAt && olderThan(now, branch.firstObservedAt, 10)) {
      alerts.push(alert({
        key: `branch-no-commit:${branch.key}:${branch.firstObservedAt}`,
        kind: "branch-no-commit",
        recipients,
        url: branch.url,
        message: `브랜치를 만든 뒤 ${formatElapsed(now, branch.firstObservedAt)}째 새 커밋이 없어요. 작업을 이어서 해 주세요.`
      }));
    }
    if (branch.commitsAhead > 0 && !pullRequestBranches.has(`${branch.repository}:${branch.name}`) && olderThan(now, branch.lastCommitAt, 24)) {
      alerts.push(alert({
        key: `branch-stalled:${branch.key}:${branch.lastCommitAt}`,
        kind: "branch-stalled",
        recipients,
        url: branch.url,
        message: `마지막 커밋 뒤 ${formatElapsed(now, branch.lastCommitAt)}째 새 커밋과 PR이 모두 없어요. 작업을 이어서 해 주세요.`
      }));
    }
  }

  for (const pr of pullRequests.filter((pr) => !pr.isDraft)) {
    if (pr.reviewers.length > 0 && pr.lastReviewRequestAt && (!pr.lastReviewAt || date(pr.lastReviewAt) < date(pr.lastReviewRequestAt)) && olderThan(now, pr.lastReviewRequestAt, 5)) {
      alerts.push(alert({
        key: `pr-review-waiting:${pr.repository}#${pr.number}:${pr.lastReviewRequestAt}`,
        kind: "pr-review-waiting",
        recipients: pr.reviewers,
        url: pr.url,
        message: `리뷰 요청 뒤 ${formatElapsed(now, pr.lastReviewRequestAt)}째 응답이 없어요. PR을 확인해 주세요.`
      }));
    }
    if (pr.lastApprovalAt && olderThan(now, pr.lastApprovalAt, 1)) {
      alerts.push(alert({
        key: `pr-approved-not-merged:${pr.repository}#${pr.number}:${pr.lastApprovalAt}`,
        kind: "pr-approved-not-merged",
        recipients: [pr.author],
        url: pr.url,
        message: `승인된 뒤 ${formatElapsed(now, pr.lastApprovalAt)}째 병합되지 않았어요. 병합해 주세요.`
      }));
    }
    if (pr.lastChangesRequestedAt && (!pr.lastCommitAt || date(pr.lastCommitAt) <= date(pr.lastChangesRequestedAt)) && olderThan(now, pr.lastChangesRequestedAt, 5)) {
      alerts.push(alert({
        key: `pr-changes-not-updated:${pr.repository}#${pr.number}:${pr.lastChangesRequestedAt}`,
        kind: "pr-changes-not-updated",
        recipients: [pr.author],
        url: pr.url,
        message: `변경 요청 뒤 ${formatElapsed(now, pr.lastChangesRequestedAt)}째 새 커밋이 없어요. 수정해 주세요.`
      }));
    }
  }

  return alerts.filter((item) => item.recipients.length > 0);
}
