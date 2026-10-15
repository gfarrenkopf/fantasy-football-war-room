import { createPrivateKey, sign } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import type { ApnsEnvironment } from "@/lib/db/schema";

/**
 * Apple Push Notification service, spoken directly over HTTP/2 with a token (.p8) key (21.2). No
 * config or database imports: push.ts wires it up, and tests drive it with a fake transport.
 * https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 */

export type ApnsKey = { keyId: string; teamId: string; privateKey: string };

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com",
};

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The provider token: a JWT signed with the key (ES256), naming the team. Apple rejects one older than an hour. */
export function apnsJwt(key: ApnsKey, now = Math.floor(Date.now() / 1000)): string {
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: key.keyId }))}.${b64url(JSON.stringify({ iss: key.teamId, iat: now }))}`;
  // JWS wants the raw r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(key.privateKey), dsaEncoding: "ieee-p1363" });
  return `${input}.${b64url(signature)}`;
}

/** Apple throttles providers that make a new token more than once every 20 minutes; it expires after 60. */
const JWT_TTL_SECONDS = 50 * 60;

/** One HTTP/2 request to APNs, and what came back. */
export type ApnsRequest = { host: string; path: string; headers: Record<string, string>; body: string };
export type ApnsReply = { status: number; reason?: string };
export type ApnsTransport = (request: ApnsRequest) => Promise<ApnsReply>;

/** What to send, before it's addressed to a device. */
export type ApnsMessage = {
  /** `alert` for notifications, `liveactivity` for Live Activity updates (21.5). */
  pushType: "alert" | "liveactivity";
  /** The app's bundle ID, with `.push-type.liveactivity` for Live Activities. */
  topic: string;
  payload: Record<string, unknown>;
  /** 10 delivers now; 5 lets the phone pick a moment that saves power. */
  priority?: 5 | 10;
  /** Newer pushes with the same id replace older ones still on the phone. At most 64 bytes. */
  collapseId?: string;
  /** Unix seconds after which APNs stops trying; 0 means try once. */
  expiration?: number;
};

/** What became of one device: sent, gone for good (forget the token), or failed this time. */
export type ApnsOutcome = { kind: "sent" } | { kind: "dead"; reason: string } | { kind: "failed"; status: number; reason: string };

/** Reasons that mean the token will never work again. */
const DEAD = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export type ApnsClient = {
  send(device: { token: string; environment: ApnsEnvironment }, message: ApnsMessage): Promise<ApnsOutcome>;
};

export function createApnsClient(
  key: ApnsKey,
  opts: { transport?: ApnsTransport; sleep?: (ms: number) => Promise<void>; now?: () => number; retries?: number } = {},
): ApnsClient {
  const transport = opts.transport ?? http2Transport();
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const retries = opts.retries ?? 2;
  let jwt: { token: string; at: number } | undefined;
  const providerToken = (fresh = false) => {
    const t = now();
    if (fresh || !jwt || t - jwt.at > JWT_TTL_SECONDS) jwt = { token: apnsJwt(key, t), at: t };
    return jwt.token;
  };

  return {
    async send(device, message) {
      const headers = (token: string): Record<string, string> => ({
        authorization: `bearer ${token}`,
        "apns-topic": message.topic,
        "apns-push-type": message.pushType,
        "apns-priority": String(message.priority ?? 10),
        ...(message.collapseId ? { "apns-collapse-id": message.collapseId } : {}),
        ...(message.expiration !== undefined ? { "apns-expiration": String(message.expiration) } : {}),
      });
      const request = (token: string): ApnsRequest => ({
        host: APNS_HOSTS[device.environment],
        path: `/3/device/${device.token}`,
        headers: headers(token),
        body: JSON.stringify(message.payload),
      });

      let refreshed = false;
      for (let attempt = 0; ; attempt++) {
        let reply: ApnsReply;
        try {
          reply = await transport(request(providerToken()));
        } catch (err) {
          reply = { status: 0, reason: err instanceof Error ? err.message : String(err) };
        }
        if (reply.status === 200) return { kind: "sent" };
        const reason = reply.reason ?? "";
        if (reply.status === 410 || DEAD.has(reason)) return { kind: "dead", reason: reason || "Unregistered" };
        // The cached provider token was refused (clock skew, key rotated): make a new one, once.
        if (reply.status === 403 && reason === "ExpiredProviderToken" && !refreshed) {
          refreshed = true;
          providerToken(true);
          continue;
        }
        const retryable = reply.status === 0 || reply.status === 429 || reply.status >= 500;
        if (!retryable || attempt >= retries) return { kind: "failed", status: reply.status, reason };
        await sleep(250 * 2 ** attempt);
      }
    },
  };
}

/** The real transport: one HTTP/2 connection per APNs host, reopened when it closes. */
export function http2Transport(timeoutMs = 10_000): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>();
  const session = (host: string) => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = connect(`https://${host}`);
    s.on("error", () => s.destroy());
    s.on("close", () => sessions.get(host) === s && sessions.delete(host));
    // Don't keep the process alive for an idle connection.
    s.unref();
    sessions.set(host, s);
    return s;
  };
  return (req) =>
    new Promise((resolve, reject) => {
      const stream = session(req.host).request({
        [constants.HTTP2_HEADER_METHOD]: "POST",
        [constants.HTTP2_HEADER_PATH]: req.path,
        "content-type": "application/json",
        ...req.headers,
      });
      let status = 0;
      let data = "";
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        let reason: string | undefined;
        try {
          reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
        } catch {
          reason = undefined;
        }
        // Status 0: the stream closed without an answer (a timeout or a dropped connection), which the client retries.
        resolve({ status, reason: reason ?? (status ? undefined : "NoResponse") });
      };
      stream.setTimeout(timeoutMs, () => stream.close(constants.NGHTTP2_CANCEL));
      stream.on("response", (headers) => (status = Number(headers[constants.HTTP2_HEADER_STATUS])));
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => (data += chunk));
      stream.on("end", finish);
      stream.on("close", finish);
      stream.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      stream.end(req.body);
    });
}
