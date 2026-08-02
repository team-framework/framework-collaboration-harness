# 하네스 자동 동기화

`framework-collaboration-harness`가 협업 가이드의 원본이에요. 원본이 바뀌면 설치된 GitHub App이 접근할 수 있는 레포를 자동으로 찾고, 필요한 파일만 담은 Draft PR을 하나씩 만들어요.

## 동기화 대상

- `.codex/skills/{issue,branch,commit,pull-request}`
- `.claude/skills/{issue,branch,commit,pull-request}`
- `.github/ISSUE_TEMPLATE/{01-feat,02-fix,03-chore,04-refactor}.yml`
- `.github/pull_request_template.md`
- `.github/workflows/assign-issue-author.yml`

Discord 알림 코드, 배포 설정, 대상 레포의 고유 스킬은 동기화하지 않아요.

같은 대상 레포에 열린 동기화 PR이 있으면 새 PR을 만들지 않아요. PR을 머지하거나 닫은 다음 실행에서 최신 원본으로 다시 동기화해요.

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

Webhooks와 사용자 권한은 필요 없어요. App의 Client ID는 하네스 레포 Variables의 `HARNESS_SYNC_APP_CLIENT_ID`에, private key는 Secrets의 `HARNESS_SYNC_APP_PRIVATE_KEY`에 넣어요.

설정 전에는 워크플로가 실패하지 않고 동기화를 건너뛰어요. 설정 후 Actions에서 **Sync Collaboration Harness**를 수동 실행해 첫 Draft PR 세 개가 생성되는지 확인해요.
