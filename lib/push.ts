import webpush from "web-push";
import { query } from "./db";

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

async function vapidKeys() {
  const configuredPublicKey = process.env.WEB_PUSH_PUBLIC_KEY;
  const configuredPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (configuredPublicKey && configuredPrivateKey) {
    return { publicKey: configuredPublicKey, privateKey: configuredPrivateKey };
  }

  const existing = await query(
    "SELECT public_key, private_key FROM push_settings WHERE singleton = true"
  );
  if (existing.rowCount) {
    return {
      publicKey: existing.rows[0].public_key as string,
      privateKey: existing.rows[0].private_key as string
    };
  }

  const generated = webpush.generateVAPIDKeys();
  await query(
    `INSERT INTO push_settings (singleton, public_key, private_key)
     VALUES (true, $1, $2)
     ON CONFLICT (singleton) DO NOTHING`,
    [generated.publicKey, generated.privateKey]
  );
  const stored = await query(
    "SELECT public_key, private_key FROM push_settings WHERE singleton = true"
  );
  return {
    publicKey: stored.rows[0].public_key as string,
    privateKey: stored.rows[0].private_key as string
  };
}

export async function getPushPublicKey() {
  return (await vapidKeys()).publicKey;
}

type SubscriptionRow = { endpoint: string; p256dh: string; auth: string };

type DeliveryOutcome =
  | { ok: true }
  | { ok: false; stale: true }
  | { ok: false; stale: false; details: Record<string, unknown> };

async function deliver(
  subscription: SubscriptionRow,
  payload: PushPayload
): Promise<DeliveryOutcome> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "high", timeout: 10_000 }
      );
      return { ok: true };
    } catch (error) {
      lastError = error;
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        return { ok: false, stale: true };
      }
      // Transient network failure (e.g. Docker outbound connect timeouts or a
      // container still settling after startup) — retry with a growing delay.
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  const statusCode = (lastError as { statusCode?: number }).statusCode;
  const body = (lastError as { body?: string }).body;
  return {
    ok: false,
    stale: false,
    details: {
      statusCode: statusCode ?? "unknown",
      name: lastError instanceof Error ? lastError.name : typeof lastError,
      message: lastError instanceof Error ? lastError.message : String(lastError),
      body: typeof body === "string" ? body.slice(0, 500) : undefined,
      stack: lastError instanceof Error ? lastError.stack?.split("\n").slice(0, 4) : undefined
    }
  };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const subscriptions = await query(
    `SELECT endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE user_id = $1`,
    [userId]
  );
  if (!subscriptions.rowCount) return { sent: 0, failed: 0 };

  const keys = await vapidKeys();
  webpush.setVapidDetails(
    process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@example.com",
    keys.publicKey,
    keys.privateKey
  );

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subscriptions.rows.map(async (subscription) => {
      const outcome = await deliver(subscription as SubscriptionRow, payload);
      if (outcome.ok) {
        sent += 1;
        return;
      }
      failed += 1;
      if (outcome.stale) {
        await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [
          subscription.endpoint
        ]);
      } else {
        console.error("Push delivery failed", outcome.details);
      }
    })
  );
  return { sent, failed };
}
