const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
const SESSION_RESET_CLOSE_CODES = new Set([4007, 4009]);

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

export function resumePayload({ token, sessionId, sequence }) {
  return {
    op: 6,
    d: { token, session_id: sessionId, seq: sequence }
  };
}

export function keepDiscordOnline({
  token,
  WebSocketImpl = WebSocket,
  onReady = () => {},
  onFatal = () => {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  random = Math.random
}) {
  let socket;
  let sequence = null;
  let sessionId = null;
  let resumeGatewayUrl = null;
  let heartbeatTimer;
  let heartbeatStartTimer;
  let reconnectTimer;
  let awaitingHeartbeatAck = false;
  let reconnectAttempts = 0;
  let shouldResume = false;
  let stopped = false;

  const clearTimers = () => {
    clearIntervalImpl(heartbeatTimer);
    clearTimeoutImpl(heartbeatStartTimer);
    clearTimeoutImpl(reconnectTimer);
  };
  const clearSession = () => {
    sequence = null;
    sessionId = null;
    resumeGatewayUrl = null;
    shouldResume = false;
  };
  const canResume = () => shouldResume && sessionId && resumeGatewayUrl && sequence != null;
  const send = (payload) => {
    if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify(payload));
  };
  const heartbeat = () => {
    if (awaitingHeartbeatAck) {
      socket?.close(4000, "Heartbeat ACK timeout");
      return;
    }
    awaitingHeartbeatAck = true;
    send({ op: 1, d: sequence });
  };
  const startHeartbeat = (interval) => {
    clearIntervalImpl(heartbeatTimer);
    clearTimeoutImpl(heartbeatStartTimer);
    heartbeatStartTimer = setTimeoutImpl(() => {
      heartbeat();
      heartbeatTimer = setIntervalImpl(heartbeat, interval);
    }, Math.floor(interval * random()));
  };
  const reconnectDelay = () => {
    if (canResume()) return 5_000;
    return Math.min(300_000, 60_000 * (2 ** reconnectAttempts));
  };
  const queueReconnect = () => {
    if (stopped) return;
    reconnectTimer = setTimeoutImpl(connect, reconnectDelay());
  };
  const connect = () => {
    reconnectTimer = undefined;
    awaitingHeartbeatAck = false;
    socket = new WebSocketImpl(canResume() ? resumeGatewayUrl : GATEWAY_URL);
    socket.addEventListener("message", ({ data }) => {
      const payload = JSON.parse(data);
      if (payload.s != null) sequence = payload.s;
      if (payload.op === 10) {
        startHeartbeat(payload.d.heartbeat_interval);
        if (canResume()) send(resumePayload({ token, sessionId, sequence }));
        else send(identifyPayload(token));
      } else if (payload.op === 11) {
        awaitingHeartbeatAck = false;
      } else if (payload.op === 1) {
        heartbeat();
      } else if (payload.op === 7) {
        socket.close(4000, "Discord reconnect request");
      } else if (payload.op === 9) {
        if (!payload.d) clearSession();
        socket.close(4000, "Invalid Discord session");
      } else if (payload.op === 0 && payload.t === "READY") {
        sessionId = payload.d.session_id;
        resumeGatewayUrl = payload.d.resume_gateway_url;
        shouldResume = true;
        reconnectAttempts = 0;
        onReady(payload.d.user);
      }
    });
    socket.addEventListener("close", ({ code = 1006 }) => {
      clearIntervalImpl(heartbeatTimer);
      clearTimeoutImpl(heartbeatStartTimer);
      if (stopped) return;
      if (FATAL_CLOSE_CODES.has(code)) {
        stopped = true;
        onFatal(code);
        return;
      }
      if (SESSION_RESET_CLOSE_CODES.has(code)) clearSession();
      if (!canResume()) reconnectAttempts += 1;
      queueReconnect();
    });
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    socket?.close(1000, "Framework Bot 종료");
  };
}

if (import.meta.main) {
  const stop = keepDiscordOnline({
    token: requiredEnv("DISCORD_BOT_TOKEN"),
    onReady: (user) => console.log(`Discord Gateway 연결 완료: ${user.username}`),
    onFatal: (code) => console.error(`Discord Gateway가 종료됐어요. close code: ${code}. 새 토큰 또는 Gateway 설정을 확인해 주세요.`)
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
