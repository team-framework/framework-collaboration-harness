import { createHash, createSign } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { selectTargets } from "./discover.mjs";
import { syncBranch, syncCommitMessage, syncItems, syncPullRequestTitle } from "./manifest.mjs";

const API_BASE_URL = "https://api.github.com";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createAppJwt({ appId, privateKey, now = () => Date.now() }) {
  const issuedAt = Math.floor(now() / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 600, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKey, "base64url")}`;
}

function gitBlobSha(content) {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`동기화 파일은 일반 파일 또는 디렉터리여야 해요: ${path}`);
  }
  return files;
}

export async function loadSyncTree({ sourceRoot, items = syncItems }) {
  const files = [];
  for (const item of items) {
    const source = join(sourceRoot, item.source);
    const stat = await lstat(source);
    const itemFiles = stat.isDirectory() ? await filesBelow(source) : [source];
    for (const file of itemFiles) {
      const stat = await lstat(file);
      if (!stat.isFile()) throw new Error(`동기화 파일은 일반 파일이어야 해요: ${file}`);
      const content = await readFile(file);
      files.push({ path: join(item.destination, relative(source, file)).replaceAll("\\", "/"), content, sha: gitBlobSha(content) });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function githubClient({ token, fetchImpl = fetch }) {
  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      const error = new Error(`GitHub API 요청에 실패했어요: ${method} ${path} (${response.status}) ${await response.text()}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  return { request };
}

async function installationToken({ appId, privateKey, installationId, fetchImpl, now }) {
  if (!installationId) throw new Error("GitHub App installation ID가 없어요.");
  const app = githubClient({ token: createAppJwt({ appId, privateKey, now }), fetchImpl });
  const result = await app.request(`/app/installations/${installationId}/access_tokens`, { method: "POST" });
  if (!result.token) throw new Error("GitHub App installation token을 받지 못했어요.");
  return result.token;
}

async function installedRepositories(client) {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const result = await client.request(`/installation/repositories?per_page=100&page=${page}`);
    repositories.push(...(result.repositories || []));
    if ((result.repositories || []).length < 100) return repositories;
  }
}

async function hasOpenSyncPullRequest(client, repository) {
  const owner = repository.split("/")[0];
  const pulls = await client.request(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${syncBranch}`)}&per_page=1`);
  return pulls[0] || null;
}

async function baseCommitFor(client, target) {
  try {
    const ref = await client.request(`/repos/${target.repository}/git/ref/heads/${encodeURIComponent(target.baseBranch)}`);
    return client.request(`/repos/${target.repository}/git/commits/${ref.object.sha}`);
  } catch (error) {
    if (error.status !== 409) throw error;

    await client.request(`/repos/${target.repository}/contents/.gitkeep`, {
      method: "POST",
      body: {
        message: "chore: 저장소 초기화",
        content: "",
        branch: target.baseBranch
      }
    });
    const ref = await client.request(`/repos/${target.repository}/git/ref/heads/${encodeURIComponent(target.baseBranch)}`);
    return client.request(`/repos/${target.repository}/git/commits/${ref.object.sha}`);
  }
}

async function createSyncPullRequest({ client, target, files }) {
  const existing = await hasOpenSyncPullRequest(client, target.repository);
  if (existing) return { repository: target.repository, status: "existing_pr", detail: existing.html_url };

  const baseCommit = await baseCommitFor(client, target);
  const baseCommitSha = baseCommit.sha;
  const baseTree = await client.request(`/repos/${target.repository}/git/trees/${baseCommit.tree.sha}?recursive=1`);
  const existingBlobs = new Map(baseTree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
  const changedFiles = files.filter((file) => existingBlobs.get(file.path) !== file.sha);
  if (changedFiles.length === 0) return { repository: target.repository, status: "no_changes" };

  const tree = await client.request(`/repos/${target.repository}/git/trees`, {
    method: "POST",
    body: {
      base_tree: baseCommit.tree.sha,
      tree: changedFiles.map((file) => ({ path: file.path, mode: "100644", type: "blob", content: file.content.toString("utf8") }))
    }
  });
  const commit = await client.request(`/repos/${target.repository}/git/commits`, {
    method: "POST",
    body: { message: syncCommitMessage, tree: tree.sha, parents: [baseCommitSha] }
  });
  await client.request(`/repos/${target.repository}/git/refs`, { method: "POST", body: { ref: `refs/heads/${syncBranch}`, sha: commit.sha } });
  const pullRequest = await client.request(`/repos/${target.repository}/pulls`, {
    method: "POST",
    body: {
      title: syncPullRequestTitle,
      head: syncBranch,
      base: target.baseBranch,
      draft: true,
      body: "Framework Collaboration Harness 변경을 동기화했어요."
    }
  });
  return { repository: target.repository, status: "pr_created", detail: pullRequest.html_url };
}

export async function syncHarnessInstallation({ installationId, config, sourceRoot, fetchImpl = fetch, now = () => Date.now() }) {
  const token = await installationToken({ ...config, installationId, fetchImpl, now });
  const client = githubClient({ token, fetchImpl });
  const [repositories, files] = await Promise.all([installedRepositories(client), loadSyncTree({ sourceRoot })]);
  const targets = selectTargets(repositories, { sourceRepository: config.sourceRepository });
  const results = [];
  for (const target of targets) results.push(await createSyncPullRequest({ client, target, files }));
  return results;
}
