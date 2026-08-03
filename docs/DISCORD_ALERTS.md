# Discord 알림 실행

알림기는 GitHub의 현재 이슈·브랜치·PR 상태를 읽고, 기준 시간을 넘긴 작업만 담당자 개인 채널에 멘션해요. Discord에서 읽었는지 여부는 사용하지 않아요.

## 설정

`.env.example`을 참고해 실행 환경에 아래 값을 등록해요. 실제 `.env`와 토큰·Discord ID는 절대 커밋하지 않아요.

- `GITHUB_TOKEN`: 감시 대상 저장소를 읽는 fine-grained token이에요.
- `DISCORD_BOT_TOKEN`: Framework Bot 토큰이에요.
- `TARGET_REPOSITORIES`: 감시할 `owner/repository` 목록이에요.
- `DISCORD_RECIPIENTS_JSON`: GitHub 아이디, Discord 사용자 ID, 개인 알림 채널 ID의 연결 정보예요.
- `DISCORD_TEAM_ROLE_ID`, `DISCORD_TEAM_CHANNEL_ID`: 오전 9시 일일 요약에만 사용해요.

## 실행

```bash
npm test
npm run alerts:dry-run
npm run alerts:send-test
npm run discord:gateway
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

## 운영 방식

알림기는 최소 한 시간마다 실행하고, 일일 요약은 Asia/Seoul 오전 9시에 `node alerts/run.mjs --summary`로 실행하면 돼요. GitHub Actions 스케줄은 지연될 수 있고 상태 파일을 영구 보존하기 어렵기 때문에, 실제 운영은 영속 디스크가 있는 서버나 컨테이너가 적합해요.
