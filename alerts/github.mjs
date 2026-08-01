const API_BASE_URL = "https://api.github.com";

function apiPath(path) {
  return `${API_BASE_URL}/${path}`;
}

function issueNumberFromBranch(name) {
  const match = name.match(/\/#(\d+)$/);
  return match ? Number(match[1]) : null;
}

function latestAt(items, predicate) {
  return items.filter(predicate).map((item) => item.submitted_at || item.created_at).filter(Boolean).sort().at(-1) || null;
}

export function githubClient({ token, fetchImpl = fetch }) {
  async function get(path) {
    const response = await fetchImpl(apiPath(path), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) throw new Error(`GitHub API 요청에 실패했어요: ${response.status} ${await response.text()}`);
    return response.json();
  }
  return { get };
}

async function assignedAt(client, repository, issue) {
  if (issue.assignees.length === 0) return null;
  const timeline = await client.get(`repos/${repository}/issues/${issue.number}/timeline?per_page=100`);
  const assignees = new Set(issue.assignees.map((assignee) => assignee.login));
  return timeline
    .filter((event) => event.event === "assigned" && assignees.has(event.assignee?.login))
    .map((event) => event.created_at)
    .sort()
    .at(-1) || issue.created_at;
}

async function teamMembers(client, owner, slug, cache) {
  const key = `${owner}/${slug}`;
  if (!cache.has(key)) {
    cache.set(key, client.get(`orgs/${owner}/teams/${slug}/members?per_page=100`).then((members) => members.map((member) => member.login)));
  }
  return cache.get(key);
}

async function pullRequestSnapshot(client, repository, owner, pr, memberCache) {
  const [timeline, reviews, commits] = await Promise.all([
    client.get(`repos/${repository}/issues/${pr.number}/timeline?per_page=100`),
    client.get(`repos/${repository}/pulls/${pr.number}/reviews?per_page=100`),
    client.get(`repos/${repository}/commits?sha=${encodeURIComponent(pr.head.ref)}&per_page=1`)
  ]);
  const userReviewers = pr.requested_reviewers.map((reviewer) => reviewer.login);
  const teamReviewers = await Promise.all(pr.requested_teams.map((team) => teamMembers(client, owner, team.slug, memberCache)));
  const reviewers = [...new Set([...userReviewers, ...teamReviewers.flat()])];
  const requestEvents = timeline.filter((event) => event.event === "review_requested");

  return {
    repository,
    number: pr.number,
    url: pr.html_url,
    author: pr.user.login,
    headRef: pr.head.ref,
    isDraft: pr.draft,
    createdAt: pr.created_at,
    reviewers,
    lastReviewRequestAt: requestEvents.map((event) => event.created_at).sort().at(-1) || (reviewers.length > 0 ? pr.created_at : null),
    lastReviewAt: latestAt(reviews, (review) => review.state !== "PENDING"),
    lastApprovalAt: latestAt(reviews, (review) => review.state === "APPROVED"),
    lastChangesRequestedAt: latestAt(reviews, (review) => review.state === "CHANGES_REQUESTED"),
    lastCommitAt: commits[0]?.commit?.author?.date || null
  };
}

export async function collectSnapshot({ token, repositories, fetchImpl }) {
  const client = githubClient({ token, fetchImpl });
  const allIssues = [];
  const allBranches = [];
  const allPullRequests = [];
  const memberCache = new Map();

  for (const repository of repositories) {
    const [owner, name] = repository.split("/");
    const [details, issues, branches, pullRequests] = await Promise.all([
      client.get(`repos/${repository}`),
      client.get(`repos/${repository}/issues?state=open&per_page=100`),
      client.get(`repos/${repository}/branches?per_page=100`),
      client.get(`repos/${repository}/pulls?state=open&per_page=100`)
    ]);
    const mappedIssues = await Promise.all(issues.filter((issue) => !issue.pull_request).map(async (issue) => ({
      repository,
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
      assignees: issue.assignees.map((assignee) => assignee.login),
      assignedAt: await assignedAt(client, repository, issue)
    })));
    const issueByNumber = new Map(mappedIssues.map((issue) => [issue.number, issue]));
    const mappedBranches = await Promise.all(branches.map(async (branch) => {
      const issueNumber = issueNumberFromBranch(branch.name);
      if (!issueNumber) return null;
      const comparison = await client.get(`repos/${repository}/compare/${encodeURIComponent(details.default_branch)}...${encodeURIComponent(branch.name)}`);
      const issue = issueByNumber.get(issueNumber);
      return {
        key: `${repository}:${branch.name}`,
        repository,
        name: branch.name,
        issueNumber,
        assignees: issue?.assignees || [],
        commitsAhead: comparison.ahead_by,
        lastCommitAt: comparison.commits.at(-1)?.commit?.author?.date || null,
        url: `https://github.com/${repository}/tree/${encodeURIComponent(branch.name)}`
      };
    }));

    allIssues.push(...mappedIssues);
    allBranches.push(...mappedBranches.filter(Boolean));
    allPullRequests.push(...await Promise.all(pullRequests.map((pr) => pullRequestSnapshot(client, repository, owner, pr, memberCache))));
  }
  return { issues: allIssues, branches: allBranches, pullRequests: allPullRequests };
}
