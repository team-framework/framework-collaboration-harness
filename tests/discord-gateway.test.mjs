import assert from "node:assert/strict";
import test from "node:test";
import { identifyPayload, keepDiscordOnline, resumePayload } from "../alerts/discord-gateway.mjs";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000) {
    this.readyState = 3;
    this.listeners.get("close")?.({ code });
  }

  message(payload) {
    this.listeners.get("message")?.({ data: JSON.stringify(payload) });
  }
}

function fakeTimers() {
  const timers = [];
  const add = (type, callback, delay) => {
    const timer = { type, callback, delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  const clear = (timer) => {
    if (timer) timer.cancelled = true;
  };

  return {
    setTimeoutImpl: (callback, delay) => add("timeout", callback, delay),
    clearTimeoutImpl: clear,
    setIntervalImpl: (callback, delay) => add("interval", callback, delay),
    clearIntervalImpl: clear,
    runNextTimeout() {
      const timer = timers.find((candidate) => candidate.type === "timeout" && !candidate.cancelled);
      assert.ok(timer, "실행할 timeout이 있어야 해요.");
      timer.cancelled = true;
      timer.callback();
      return timer.delay;
    },
    activeTimeoutDelays() {
      return timers.filter((timer) => timer.type === "timeout" && !timer.cancelled).map((timer) => timer.delay);
    }
  };
}

test("Identify와 Resume payload를 구분해요", () => {
  assert.equal(identifyPayload("token").op, 2);
  assert.deepEqual(resumePayload({ token: "token", sessionId: "session", sequence: 42 }), {
    op: 6,
    d: { token: "token", session_id: "session", seq: 42 }
  });
});

test("READY 뒤 연결이 끊기면 Identify 대신 Resume으로 다시 연결해요", () => {
  FakeWebSocket.instances = [];
  const timers = fakeTimers();
  keepDiscordOnline({
    token: "token",
    WebSocketImpl: FakeWebSocket,
    ...timers,
    random: () => 0
  });

  const first = FakeWebSocket.instances[0];
  first.message({ op: 10, d: { heartbeat_interval: 45_000 } });
  first.message({ op: 0, s: 42, t: "READY", d: { user: { username: "Framework Bot" }, session_id: "session", resume_gateway_url: "wss://resume.example/?v=10&encoding=json" } });
  first.close(1006);

  assert.deepEqual(timers.activeTimeoutDelays(), [5_000]);
  timers.runNextTimeout();
  const second = FakeWebSocket.instances[1];
  assert.equal(second.url, "wss://resume.example/?v=10&encoding=json");
  second.message({ op: 10, d: { heartbeat_interval: 45_000 } });
  assert.deepEqual(second.sent.at(-1), resumePayload({ token: "token", sessionId: "session", sequence: 42 }));
});

test("인증 실패 close code는 재접속하지 않아요", () => {
  FakeWebSocket.instances = [];
  const timers = fakeTimers();
  const fatalCodes = [];
  keepDiscordOnline({
    token: "token",
    WebSocketImpl: FakeWebSocket,
    onFatal: (code) => fatalCodes.push(code),
    ...timers
  });

  FakeWebSocket.instances[0].close(4004);

  assert.deepEqual(fatalCodes, [4004]);
  assert.deepEqual(timers.activeTimeoutDelays(), []);
});
