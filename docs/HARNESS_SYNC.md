# 하네스 자동 동기화

`framework-collaboration-harness`가 협업 가이드의 원본이에요. 원본이 바뀌면 설치된 GitHub App이 접근할 수 있는 레포를 자동으로 찾고, 필요한 파일만 담은 Draft PR을 하나씩 만들어요. App을 새 레포에 설치하거나 기존 설치 범위에 새 레포를 추가하면 `installation.created` 또는 `installation_repositories.added` webhook으로 즉시 같은 Draft PR을 만들어요.

## 동기화 대상

- `AGENTS.md`, `CLAUDE.md` (기존 내용은 보존하고 하네스 관리 섹션만 추가 또는 갱신)
- `.codex/skills/{issue,branch,commit,pull-request}`
- `.claude/skills/{issue,branch,commit,pull-request}`
- `.github/ISSUE_TEMPLATE/{01-feat,02-fix,03-chore,04-refactor}.yml`
- `.github/pull_request_template.md`

GitHub App 설치 토큰은 GitHub Actions workflow 파일을 만들 수 없으므로 `.github/workflows/assign-issue-author.yml`은 자동 동기화 대상에서 제외해요. Discord 알림 코드, 배포 설정, 대상 레포의 고유 스킬도 동기화하지 않아요.

`AGENTS.md` 또는 `CLAUDE.md`가 이미 있는 대상 레포는 해당 파일을 덮어쓰지 않아요. `framework-collaboration-harness` 관리 마커 사이의 섹션만 갱신하므로 제품 고유 지시는 유지돼요.

같은 대상 레포에 열린 동기화 PR이 있으면 새 PR을 만들지 않아요. PR을 머지하거나 닫은 다음 실행에서 최신 원본으로 다시 동기화해요.

자동 동기화 PR은 작업 이슈가 없는 봇 작업이므로 일반 PR의 이슈 번호 규칙 대신 `chore: collaboration-harness-sync` 제목을 사용해요.

## 최초 설정

GitHub App을 조직에 설치할 때는 우선 아래 세 레포만 선택해요.

- `innolive-client`
- `innolive-server`
- `innolive-ai`

이후 App 설치 범위를 바꾸면 별도 대상 목록을 수정하지 않아도 다음 동기화에서 자동 반영돼요.

App에는 아래 Repository permissions가 필요해요.

- Contents: Read and write
- Pull requests: Read and write
- Metadata: Read-only

App은 `Installation`과 `Installation repositories` webhook을 구독하고, webhook URL을 배포한 하네스의 `/github/webhooks`로 설정해야 해요. App의 Client ID는 하네스 레포 Variables의 `HARNESS_SYNC_APP_CLIENT_ID`에, private key는 Secrets의 `HARNESS_SYNC_APP_PRIVATE_KEY`에 넣어요. 동일한 Client ID·private key와 `HARNESS_SYNC_SOURCE_REPOSITORY=team-framework/framework-collaboration-harness`를 서버 `.env`에도 설정해야 설치 직후 동기화를 실행할 수 있어요.

설정 전에는 워크플로가 실패하지 않고 동기화를 건너뛰어요. 설정 후 빈 레포 하나에 App을 설치해 `chore: collaboration-harness-sync` Draft PR이 생성되는지 확인해요. 기존 설치 레포는 Actions에서 **Sync Collaboration Harness**를 수동 실행해 최초 동기화를 할 수 있어요.
