const skillNames = ["issue", "branch", "commit", "pull-request"];
const issueTemplates = ["01-feat.yml", "02-fix.yml", "03-chore.yml", "04-refactor.yml"];

function skillItems(tool) {
  return skillNames.map((name) => ({
    id: tool + "-skill-" + name,
    source: "." + tool + "/skills/" + name,
    destination: "." + tool + "/skills/" + name
  }));
}

export const syncItems = [
  ...skillItems("codex"),
  ...skillItems("claude"),
  ...issueTemplates.map((name) => ({
    id: "issue-template-" + name,
    source: ".github/ISSUE_TEMPLATE/" + name,
    destination: ".github/ISSUE_TEMPLATE/" + name
  })),
  {
    id: "pull-request-template",
    source: ".github/pull_request_template.md",
    destination: ".github/pull_request_template.md"
  },
  {
    id: "assign-issue-author",
    source: ".github/workflows/assign-issue-author.yml",
    destination: ".github/workflows/assign-issue-author.yml"
  }
];

export const syncBranch = "harness-sync/framework-collaboration";
export const syncCommitMessage = "chore: 협업 하네스 동기화";
export const syncPullRequestTitle = "chore: 협업 하네스 동기화";
