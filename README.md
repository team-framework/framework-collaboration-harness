# Framework Collaboration Harness

Framework 팀의 GitHub 협업 흐름을 가볍게 정리하고, GitHub 상태를 기준으로 Discord 알림을 보내는 하네스예요.

규칙을 CI로 막기보다, 팀원과 AI 에이전트가 같은 이슈·브랜치·커밋·PR 기준을 읽고 일관되게 작업하도록 돕는 것을 목표로 해요.

## 제공하는 것

- Codex·Claude용 이슈, 브랜치, 커밋, PR SKILL
- GitHub Issue Form 4종: `feat`, `fix`, `chore`, `refactor`
- PR 템플릿과 이슈 생성자 자동 담당자 지정 Action
- GitHub 이슈·브랜치·PR 방치 상태 감지와 Discord 개인 알림
- GitHub App webhook 기반 저장소별 실시간 활동 피드
- 매일 오전 9시(KST) 팀 요약
- Discord 스레드의 원인·진행 과정·결론을 정리하는 `/스레드-정리`
- Discord Bot Gateway 온라인 유지와 Docker Compose 배포 구성
- `main` 푸시 시 `Deploy Discord Bot` workflow를 통한 서버 자동 배포

## 협업 기준

| 항목 | 형식 |
| --- | --- |
| 이슈 | `feat: 한국어 작업 내용` |
| 브랜치 | `feat/english-slug/#123` |
| 커밋 | `feat: 한국어 변경 내용` |
| PR | `feat: english-slug/#123` |

PR은 항상 Draft로 시작해요. 작업이 준비되면 Ready for review로 전환해요.

## 하네스 동기화

협업 가이드와 GitHub 템플릿은 이 레포를 원본으로 관리해요. GitHub App이 새 레포에 설치되면 필요한 파일만 담은 Draft PR을 즉시 자동으로 만들고, 이후 원본 변경도 동기화해요. 설정 방법은 [하네스 자동 동기화](docs/HARNESS_SYNC.md)를 참고해요.

## Discord 알림

알림은 Discord 확인 여부가 아니라 GitHub의 실제 상태를 기준으로 판단해요.

- 이슈 할당 뒤 5시간 동안 브랜치 없음
- 브랜치 관찰 뒤 10시간 동안 새 커밋 없음
- 마지막 커밋 뒤 24시간 동안 새 커밋과 PR 모두 없음
- 리뷰 요청 뒤 5시간 동안 응답 없음
- 승인 뒤 1시간 동안 병합 없음
- 변경 요청 뒤 5시간 동안 새 커밋 없음

개인 알림은 지정 사용자만 멘션하며, `@everyone`은 사용하지 않아요. 일일 팀 요약만 Framework Team 역할을 멘션해요.

Discord 스레드 안에서 `/스레드-정리`를 실행하면 `3줄 요약(문제 상황·과정·상태/결론) → 시간순 타임라인 → 다음 작업` 형태의 대화 요약을 원본 채널에 남겨요. Discord Markdown 헤딩(`#`, `##`, `###`)으로 제목과 각 항목을 계층화해 빠르게 읽을 수 있어요. 메시지에서 시작한 스레드는 원본 메시지의 답글로, 독립 생성한 스레드는 작성자를 멘션한 일반 메시지로 전송해요.

### 저장소별 실시간 활동

지연 알림과 별개로 전용 read-only GitHub App의 webhook을 받아 Discord `github` 카테고리로 전달해요. 저장소 채널은 push·이슈·Actions 같은 비-PR 활동을 받고, PR 활동은 PR마다 `저장소명-pr-번호` 채널을 하나씩 자동 생성해 모아요.

| GitHub 저장소 | Discord 채널 |
| --- | --- |
| `innolive-client` | `github / innolive-client` |
| `innolive-server` | `github / innolive-server` |
| `innolive-ai` | `github / innolive-ai` |
| `framework-collaboration-harness` | `github / framework-collaboration-harness` |

push, 이슈, PR 상태, 일반 댓글, 리뷰, 코드 라인 댓글, 리뷰 스레드, 배포, Release 활동을 실시간으로 전달해요. Actions는 `Deploy Discord Bot` 워크플로의 성공·실패만 전달하며, `check_run`·대기열·실행 중 상태는 알림으로 보내지 않아요. 댓글·리뷰·승인·변경 요청·병합·Close 등의 embed 색상을 구분해요. PR이 병합되거나 Close되면 `PR 채널 닫기` 버튼을 표시하고, 채널 관리 권한이 있는 사용자가 누르면 해당 PR 채널을 삭제해요. GitHub 댓글 안의 `@everyone`이나 사용자 멘션은 Discord 멘션으로 실행하지 않아요.

서비스 시작 시 현재 Open PR의 생성 정보, 커밋, 일반 댓글, 리뷰, 코드 라인 댓글 기록을 읽어 PR별 채널에 시간순으로 동기화해요.

## 구조

```text
GitHub 이슈·브랜치·PR
        │
        ▼
alerts/daemon.mjs ──► Discord 개인 알림 / 팀 요약
        │
        ▼
서버 runtime/ 상태 파일 (중복 알림 방지)

GitHub App webhook ──► alerts/webhook-server.mjs
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
           Discord 저장소 채널    Discord PR별 채널

main push ──► Deploy Discord Bot ──► chaeyn 서버 Docker Compose
```

## 시작하기

```bash
npm test
npm run alerts:dry-run
npm run github:webhook
npm run github:sync-open-prs
```

실제 환경 변수와 운영 방법은 [Discord 알림 문서](docs/DISCORD_ALERTS.md)를 참고해요. 토큰, Discord 사용자 ID, 채널 ID는 저장소에 넣지 않고 서버 환경 파일이나 Secret으로만 관리해요.

## 주요 경로

| 경로 | 설명 |
| --- | --- |
| `.codex/skills`, `.claude/skills` | AI 에이전트 작업 기준 |
| `.github/ISSUE_TEMPLATE` | GitHub Issue Form |
| `alerts/` | 상태 판별, Discord 전송, Gateway |
| `deploy/` | 서버 Docker Compose 구성 |
| `docs/SRS.md` | 요구사항 명세 |

## 범위

이 저장소는 협업 기준을 **안내하고 알림을 제공**해요. 제목·브랜치·커밋 형식을 CI로 강제하지는 않아요.
