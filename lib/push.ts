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
    process.env.WEB_PUSH_SUBJECT ?? "mailto:admin@xieceda.local",
    keys.publicKey,
    keys.privateKey
  );

  let sent = 0;
  let failed = 0;
  await Promise.all(
    subscriptions.rows.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: "high", timeout: 10_000 }
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [
            subscription.endpoint
          ]);
        } else {
          console.error("Push delivery failed", statusCode ?? "unknown");
        }
      }
    })
  );
  return { sent, failed };
}
