const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요해요.`);
  return value;
}

export function identifyPayload(token) {
  return {
    op: 2,
    d: {
      token,
      intents: 0,
      properties: { os: "linux", browser: "framework-harness", device: "framework-harness" },
      presence: {
        since: null,
        activities: [],
        status: "online",
        afk: false
      }
    }
  };
}

export function keepDiscordOnline({ token, WebSocketImpl = WebSocket, onReady = () => {} }) {
  let socket;
  let sequence = null;
  let heartbeat;
  let acknowledged = true;
  let stopped = false;

  const send = (payload) => {
    if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify(payload));
  };
  const connect = () => {
    socket = new WebSocketImpl(GATEWAY_URL);
    socket.addEventListener("message", ({ data }) => {
      const payload = JSON.parse(data);
      if (payload.s != null) sequence = payload.s;
      if (payload.op === 10) {
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (!acknowledged) return socket.close();
          acknowledged = false;
          send({ op: 1, d: sequence });
        }, payload.d.heartbeat_interval);
        send(identifyPayload(token));
      } else if (payload.op === 11) acknowledged = true;
      else if (payload.op === 1) send({ op: 1, d: sequence });
      else if (payload.op === 7) socket.close();
      else if (payload.op === 0 && payload.t === "READY") onReady(payload.d.user);
    });
    socket.addEventListener("close", () => {
      clearInterval(heartbeat);
      if (!stopped) setTimeout(connect, 5_000);
    });
  };

  connect();
  return () => {
    stopped = true;
    clearInterval(heartbeat);
    socket?.close(1000, "Framework Bot 종료");
  };
}

if (import.meta.main) {
  const stop = keepDiscordOnline({
    token: requiredEnv("DISCORD_BOT_TOKEN"),
    onReady: (user) => console.log(`Discord Gateway 연결 완료: ${user.username}`)
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
