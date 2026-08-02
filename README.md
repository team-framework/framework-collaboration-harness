# Framework Collaboration Harness

Framework 팀의 GitHub 협업 흐름을 가볍게 정리하고, GitHub 상태를 기준으로 Discord 알림을 보내는 하네스예요.

규칙을 CI로 막기보다, 팀원과 AI 에이전트가 같은 이슈·브랜치·커밋·PR 기준을 읽고 일관되게 작업하도록 돕는 것을 목표로 해요.

## 제공하는 것

- Codex·Claude용 이슈, 브랜치, 커밋, PR SKILL
- GitHub Issue Form 4종: `feat`, `fix`, `chore`, `refactor`
- PR 템플릿과 이슈 생성자 자동 담당자 지정 Action
- GitHub 이슈·브랜치·PR 방치 상태 감지와 Discord 개인 알림
- 매일 오전 9시(KST) 팀 요약
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

협업 가이드와 GitHub 템플릿은 이 레포를 원본으로 관리해요. GitHub App이 설치된 레포에는 필요한 파일만 담은 Draft PR을 자동으로 만들어요. 설정 방법은 [하네스 자동 동기화](docs/HARNESS_SYNC.md)를 참고해요.

## Discord 알림

알림은 Discord 확인 여부가 아니라 GitHub의 실제 상태를 기준으로 판단해요.

- 이슈 할당 뒤 5시간 동안 브랜치 없음
- 브랜치 관찰 뒤 10시간 동안 새 커밋 없음
- 마지막 커밋 뒤 24시간 동안 새 커밋과 PR 모두 없음
- 리뷰 요청 뒤 5시간 동안 응답 없음
- 승인 뒤 1시간 동안 병합 없음
- 변경 요청 뒤 5시간 동안 새 커밋 없음

개인 알림은 지정 사용자만 멘션하며, `@everyone`은 사용하지 않아요. 일일 팀 요약만 Framework Team 역할을 멘션해요.

## 구조

```text
GitHub 이슈·브랜치·PR
        │
        ▼
alerts/daemon.mjs ──► Discord 개인 알림 / 팀 요약
        │
        ▼
서버 runtime/ 상태 파일 (중복 알림 방지)

main push ──► Deploy Discord Bot ──► chaeyn 서버 Docker Compose
```

## 시작하기

```bash
npm test
npm run alerts:dry-run
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
