# Discord 알림 실행

알림기는 GitHub의 현재 이슈·브랜치·PR 상태를 읽고, 기준 시간을 넘긴 작업만 담당자 개인 채널에 멘션해요. Discord에서 읽었는지 여부는 사용하지 않아요.

실시간 GitHub 활동 피드는 이 지연 알림과 별도 서비스예요. 전용 read-only GitHub App의 webhook을 받아 Discord `github` 카테고리 아래 저장소별 채널로 전달해요.

## 설정

`.env.example`을 참고해 실행 환경에 아래 값을 등록해요. 실제 `.env`와 토큰·Discord ID는 절대 커밋하지 않아요.

- `GITHUB_TOKEN`: 감시 대상 저장소를 읽는 fine-grained token이에요.
- `DISCORD_BOT_TOKEN`: Framework Bot 토큰이에요.
- `TARGET_REPOSITORIES`: 감시할 `owner/repository` 목록이에요.
- `DISCORD_RECIPIENTS_JSON`: GitHub 아이디, Discord 사용자 ID, 개인 알림 채널 ID의 연결 정보예요.
- `DISCORD_TEAM_ROLE_ID`, `DISCORD_TEAM_CHANNEL_ID`: 오전 9시 일일 요약에만 사용해요.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: `/스레드-정리`에서 대화를 요약할 때 사용해요. 기본 모델은 `gpt-5-mini`예요.
- `GITHUB_ACTIVITY_REPOSITORIES`: 실시간 활동을 허용할 `owner/repository` 목록이에요.
- `GITHUB_WEBHOOK_SECRET`: GitHub App webhook 서명 검증에 사용하는 고엔트로피 비밀값이에요.
- `DISCORD_ACTIVITY_CHANNELS_JSON`: 각 저장소와 Discord 채널 ID의 연결 정보예요.

## 스레드 정리

메시지에서 시작한 Discord 스레드 안에서 `/스레드-정리`를 실행하면 대화를 읽고 `원인 → 진행 과정 → 결론 / 다음 작업`으로 정리해요. 결과는 스레드 안이 아니라 원본 채널의 스레드 시작 메시지에 답글로 남기며, 시작 메시지 작성자에게 답글 알림을 보내요.

Discord Developer Portal에서 `Message Content Intent`를 활성화하고, Framework Bot에 대상 채널의 `채널 보기`, `메시지 기록 보기`, `메시지 보내기` 권한을 부여해야 해요. 포럼·미디어 게시물은 부모 채널에 일반 답글을 남길 수 없어 지원하지 않아요.

한 번에 최대 500개 메시지를 읽고, AI로 보내는 텍스트는 최대 60,000자로 제한해요. 작성자 이름과 사용자 멘션은 `참여자 1`, `참여자 2`처럼 익명화해요. OpenAI 요청은 `store: false`로 전송하며, 메시지 원문이나 요약 결과를 서버 로그에 남기지 않아요.

## 실행

```bash
npm test
npm run alerts:dry-run
npm run alerts:send-test
npm run discord:gateway
npm run github:webhook
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

실시간 활동 수신기는 `X-Hub-Signature-256` HMAC-SHA256 서명을 검증하고, 허용된 네 저장소의 이벤트만 처리해요. `X-GitHub-Delivery` ID를 `GITHUB_WEBHOOK_STATE_PATH`에 보관해 GitHub 재전송으로 생기는 중복 알림을 막아요. 수신된 활동은 먼저 권한 `600`의 디스크 큐에 저장하고 HTTP `202`를 응답한 뒤 Discord로 보내므로, Discord 장애나 프로세스 재시작 중에도 다음 재시도에서 이어서 전송해요.

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

GitHub App private key나 installation access token은 필요하지 않아요. webhook secret과 Discord Bot token만 서버 `.env`에서 읽고 저장소·이미지·로그에 넣지 않아요.

## 운영 방식

알림기는 최소 한 시간마다 실행하고, 일일 요약은 Asia/Seoul 오전 9시에 `node alerts/run.mjs --summary`로 실행하면 돼요. GitHub Actions 스케줄은 지연될 수 있고 상태 파일을 영구 보존하기 어렵기 때문에, 실제 운영은 영속 디스크가 있는 서버나 컨테이너가 적합해요.

실시간 활동 서비스는 `activity` 컨테이너로 계속 실행하고, 공개 HTTPS reverse proxy는 `/github/webhooks`만 `127.0.0.1:3006`으로 전달해요. `/healthz`는 localhost 검증에만 사용해요.
