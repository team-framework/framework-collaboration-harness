import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function selectTargets(repositories, { sourceRepository }) {
  return repositories
    .filter((repository) => (
      repository.full_name !== sourceRepository
      && !repository.archived
      && !repository.disabled
      && !repository.fork
      && Boolean(repository.default_branch)
    ))
    .map((repository) => ({
      repository: repository.full_name,
      name: repository.name,
      baseBranch: repository.default_branch
    }))
    .sort((left, right) => left.repository.localeCompare(right.repository));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = argument("--input");
  const sourceRepository = argument("--source-repository");

  if (!input || !sourceRepository) {
    throw new Error("사용법: node sync/discover.mjs --input <repositories.json> --source-repository <owner/repo>");
  }

  const payload = JSON.parse(await readFile(input, "utf8"));
  const repositories = Array.isArray(payload) ? payload : payload.repositories;
  console.log(JSON.stringify({ include: selectTargets(repositories, { sourceRepository }) }));
}
