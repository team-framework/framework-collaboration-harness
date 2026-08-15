# Discord 알림 실행

알림기는 GitHub의 현재 이슈·브랜치·PR 상태를 읽고, 기준 시간을 넘긴 작업만 담당자 개인 채널에 멘션해요. Discord에서 읽었는지 여부는 사용하지 않아요.

실시간 GitHub 활동 피드는 이 지연 알림과 별도 서비스예요. 전용 read-only GitHub App의 webhook을 받아 Discord `github` 카테고리로 전달해요. 비-PR 활동은 저장소 채널로, PR 활동은 PR마다 자동 생성하는 `저장소명-pr-번호` 채널로 분리해요.

## 설정

`.env.example`을 참고해 실행 환경에 아래 값을 등록해요. 실제 `.env`와 토큰·Discord ID는 절대 커밋하지 않아요.

- `GITHUB_TOKEN`: 지연 알림과 현재 Open PR 기록 동기화에서 네 대상 저장소를 읽는 fine-grained token이에요.
- `DISCORD_BOT_TOKEN`: Framework Bot 토큰이에요.
- `TARGET_REPOSITORIES`: 감시할 `owner/repository` 목록이에요.
- `DISCORD_RECIPIENTS_JSON`: GitHub 아이디, Discord 사용자 ID, 개인 알림 채널 ID의 연결 정보예요.
- `DISCORD_TEAM_ROLE_ID`, `DISCORD_TEAM_CHANNEL_ID`: 오전 9시 일일 요약에만 사용해요.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: `/스레드-정리`에서 대화를 요약할 때 사용해요. 기본 모델은 `gpt-5-nano`예요. 이 모델은 출력 토큰을 아끼기 위해 `reasoning.effort=minimal`로 호출해요.
- `GITHUB_ACTIVITY_REPOSITORIES`: 실시간 활동을 허용할 `owner/repository` 목록이에요.
- `GITHUB_WEBHOOK_SECRET`: GitHub App webhook 서명 검증에 사용하는 고엔트로피 비밀값이에요.
- `DISCORD_ACTIVITY_CHANNELS_JSON`: 각 저장소와 기준 Discord 채널 ID의 연결 정보예요. PR 채널은 기준 채널과 같은 guild/category에 생성해요.

## PR별 활동 채널

PR 활동을 처음 받으면 `github` 카테고리에 `저장소명-pr-번호` 채널을 하나 만들어요. 이후 해당 PR의 상태 변경, 새 커밋, 일반 댓글, 리뷰, 승인, 변경 요청, 코드 라인 댓글과 리뷰 스레드만 그 채널로 보내요. PR 일반 댓글과 리뷰 알림에는 PR 본문을 반복하지 않아요.

embed 색상은 일반 댓글·코드 라인 댓글은 파란색, 일반 리뷰는 보라색, 승인은 초록색, Request Changes는 빨간색, 새 커밋은 노란색, 병합은 보라색, Close는 회색으로 구분해요.

PR 병합 또는 Close 메시지에는 `PR 채널 닫기` 버튼이 생겨요. Discord의 `채널 관리` 또는 `관리자` 권한이 있는 사용자가 누르면, topic의 관리 marker와 `closed` 상태를 확인한 뒤 그 PR 채널만 삭제해요. 다른 채널이나 Open PR 채널은 삭제하지 않아요. Framework Bot에는 `채널 보기`, `메시지 기록 보기`, `메시지 보내기`, `채널 관리` 권한이 필요해요.

`activity` 서비스가 시작될 때 현재 Open PR을 조회하고 PR 생성 정보, 커밋, 일반 댓글, 리뷰, 코드 라인 댓글을 시간순으로 동기화해요. 같은 기록은 고정 ID로 중복 전송하지 않아요. 필요하면 `npm run github:sync-open-prs`로 수동 재동기화할 수 있어요.

## 스레드 정리

Discord 스레드 안에서 `/스레드-정리`를 실행하면 대화를 읽고 `3줄 요약(문제 상황·과정·상태/결론) → 타임라인 → 다음 작업` 순서로 정리해요. Discord Markdown 헤딩(`#`, `##`, `###`)으로 제목과 3줄 요약 항목을 계층화하고, 타임라인은 중요한 확인·시도·결정만 발생 시각순으로 보여 줘서 대화 흐름을 빠르게 파악할 수 있어요. 정리본은 `# {스레드명} 스레드 정리`로 시작해요. 메시지에서 시작한 스레드는 원본 메시지의 답글로 전송하고, 독립 생성한 스레드는 원본 채널에 작성자를 멘션한 일반 메시지로 전송해요.

Discord Developer Portal에서 `Message Content Intent`를 활성화하고, Framework Bot에 대상 채널의 `채널 보기`, `메시지 기록 보기`, `메시지 보내기` 권한을 부여해야 해요. 포럼·미디어 게시물은 부모 채널에 일반 답글을 남길 수 없어 지원하지 않아요.

한 번에 최대 500개 메시지를 읽고, AI로 보내는 텍스트는 최대 60,000자로 제한해요. 작성자 이름과 사용자 멘션은 `참여자 1`, `참여자 2`처럼 익명화해요. OpenAI 요청은 `store: false`로 전송하며, 메시지 원문이나 요약 결과를 서버 로그에 남기지 않아요.

## 실행

```bash
npm test
npm run alerts:dry-run
npm run alerts:send-test
npm run discord:gateway
npm run github:webhook
npm run github:sync-open-prs
```

`alerts:dry-run`은 Discord에 보내지 않고, 실제 GitHub 상태에서 보낼 알림만 출력해요. `alerts:send-test`는 `TEST_GITHUB_USER` 또는 첫 번째 수신자에게 테스트 메시지를 보내요.

## Gateway 재연결과 토큰 교체

Gateway가 끊어지면 기존 세션 정보를 이용해 재개해요. 인증 오류나 권한 오류로 종료되면 자동 재접속하지 않고 멈춰서 잘못된 토큰으로 접속을 반복하지 않아요.

Discord에서 토큰이 재설정된 경우에는 새 토큰을 서버의 `.env`에만 등록한 뒤 아래처럼 Gateway를 다시 시작해요. 토큰을 저장소, Actions 로그, 채팅에 넣지 않아요.

```bash
cd /home/chaeyn/apps/framework-collaboration-harness
chmod 600 .env
docker compose up -d gateway
docker compose logs --tail=20 gateway
```

## 중복 방지 상태

알림기는 `ALERT_STATE_PATH`의 JSON 파일에 이미 전송한 상태와 처음 관찰한 브랜치 시각을 저장해요. 장기 실행 환경에서는 컨테이너 볼륨이나 서버 디스크처럼 재시작 뒤에도 남는 경로를 사용해야 해요.

실시간 활동 수신기는 `X-Hub-Signature-256` HMAC-SHA256 서명을 검증하고, 허용된 네 저장소의 이벤트만 처리해요. webhook delivery ID, Open PR 동기화 기록 ID, PR별 Discord 채널 ID를 `GITHUB_WEBHOOK_STATE_PATH`에 보관해 중복 알림과 중복 채널을 막아요. 수신된 활동은 먼저 권한 `600`의 디스크 큐에 저장하고 HTTP `202`를 응답한 뒤 Discord로 보내므로, Discord 장애나 프로세스 재시작 중에도 다음 재시도에서 이어서 전송해요.

## 전용 GitHub App

앱은 `team-framework` 소유의 비공개 GitHub App으로 만들고 다음 저장소에만 설치해요.

- `innolive-client`
- `innolive-server`
- `innolive-ai`
- `framework-collaboration-harness`

Repository permissions는 쓰기 권한 없이 아래 항목만 **Read-only**로 사용해요.

- Actions
- Checks
- Commit statuses
- Contents
- Deployments
- Discussions
- Issues
- Pull requests
- Metadata는 GitHub가 필수 Read-only로 자동 부여해요.

Webhook은 `Issues`, `Issue comment`, `Issue dependencies`, `Sub-issues`, `Pull request`, `Pull request review`, `Pull request review comment`, `Pull request review thread`, `Push`, `Create`, `Delete`, `Commit comment`, `Check run`, `Check suite`, `Workflow dispatch`, `Workflow job`, `Workflow run`, `Deployment`, `Deployment status`, `Discussion`, `Discussion comment`, `Release`, `Status`, `Fork`, `Wiki`, `Label`, `Milestone`, `Repository` 이벤트를 구독해요. 전용 형식이 없는 새 이벤트도 이벤트명과 action을 포함한 안전한 기본 메시지로 전달해요.

GitHub App private key나 installation access token은 필요하지 않아요. webhook은 서명 검증만 하고, 현재 Open PR 기록 동기화는 기존 read-only `GITHUB_TOKEN`을 사용해요. webhook secret, GitHub token, Discord Bot token은 서버 `.env`에서만 읽고 저장소·이미지·로그에 넣지 않아요.

## 운영 방식

알림기는 최소 한 시간마다 실행하고, 일일 요약은 Asia/Seoul 오전 9시에 `node alerts/run.mjs --summary`로 실행하면 돼요. GitHub Actions 스케줄은 지연될 수 있고 상태 파일을 영구 보존하기 어렵기 때문에, 실제 운영은 영속 디스크가 있는 서버나 컨테이너가 적합해요.

실시간 활동 서비스는 `activity` 컨테이너로 계속 실행하고, 공개 HTTPS reverse proxy는 `/github/webhooks`만 `127.0.0.1:3006`으로 전달해요. `/healthz`는 localhost 검증에만 사용해요.
