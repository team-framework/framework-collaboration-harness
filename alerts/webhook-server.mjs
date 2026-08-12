import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createActivityDeliveryQueue } from "./activity-delivery-queue.mjs";
import { loadActivityConfig } from "./config.mjs";
import { formatGitHubActivity } from "./github-activity.mjs";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function verifyWebhookSignature({ secret, body, signature }) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("GitHub webhook payload가 너무 커요."), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function respond(response, statusCode, message = "") {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(message);
}

export function createWebhookHandler({ config, fetchImpl = fetch, now = () => new Date(), deliveryQueue }) {
  let queue = Promise.resolve();
  const activityQueue = deliveryQueue || createActivityDeliveryQueue({ config, fetchImpl, now });

  async function webhookHandler(request, response) {
    const requestUrl = new URL(request.url, "http://localhost");
    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      return respond(response, 200, "ok\n");
    }
    if (request.method !== "POST" || requestUrl.pathname !== config.webhookPath) {
      return respond(response, 404, "not found\n");
    }

    try {
      const body = await readRequestBody(request);
      if (!verifyWebhookSignature({ secret: config.webhookSecret, body, signature: request.headers["x-hub-signature-256"] })) {
        return respond(response, 401, "invalid signature\n");
      }

      const event = request.headers["x-github-event"];
      const deliveryId = request.headers["x-github-delivery"];
      if (!event || !deliveryId) return respond(response, 400, "missing GitHub headers\n");

      let payload;
      try {
        payload = JSON.parse(body.toString("utf8"));
      } catch {
        return respond(response, 400, "invalid JSON\n");
      }

      if (event === "ping") return respond(response, 200, "pong\n");
      const repository = payload.repository?.full_name;
      if (!config.repositories.includes(repository)) return respond(response, 403, "repository not allowed\n");
      const activity = formatGitHubActivity(event, payload);

      const enqueue = () => activityQueue.enqueue({ deliveryId, activity });
      const resultPromise = queue.then(enqueue, enqueue);
      queue = resultPromise.then(() => undefined, () => undefined);
      const result = await resultPromise;
      return respond(response, result === "accepted" ? 202 : 200, `${result}\n`);
    } catch (error) {
      console.error(`GitHub 활동 webhook 처리에 실패했어요: ${error.message}`);
      return respond(response, error.statusCode || 502, "delivery failed\n");
    }
  }
  webhookHandler.deliveryQueue = activityQueue;
  return webhookHandler;
}

export function startWebhookServer({ env = process.env, fetchImpl = fetch } = {}) {
  const config = loadActivityConfig(env);
  const handler = createWebhookHandler({ config, fetchImpl });
  handler.deliveryQueue.triggerDrain();
  const server = createServer(handler);
  server.listen(config.webhookPort, config.webhookHost, () => {
    console.log(`GitHub 활동 webhook을 ${config.webhookHost}:${config.webhookPort}${config.webhookPath}에서 기다려요.`);
  });
  return server;
}

if (import.meta.main) startWebhookServer();
