"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { appPath } from "@/lib/base-path";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default function PushNotificationSettings({ actorId }: { actorId: string }) {
  const { t } = useI18n();
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const available =
      "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    if (!available) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        const linkedUser = localStorage.getItem("xieceda.pushUserId");
        setSubscribed(Boolean(subscription) && linkedUser === actorId);
      })
      .catch(() => setSupported(false));
  }, [actorId]);

  async function enable() {
    setBusy(true);
    setMessage("");
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") throw new Error(t("push.permissionDenied"));
      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await fetch(appPath("/api/push/public-key"));
      const { publicKey } = await keyResponse.json();
      if (!keyResponse.ok || !publicKey) throw new Error(t("push.setupFailed"));
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        }));
      const response = await fetch(appPath("/api/push/subscriptions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Actor-Id": actorId },
        body: JSON.stringify(subscription.toJSON())
      });
      if (!response.ok) throw new Error(t("push.setupFailed"));
      localStorage.setItem("xieceda.pushUserId", actorId);
      setSubscribed(true);
      setMessage(t("push.enabledMessage"));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(appPath("/api/push/subscriptions"), {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "X-Actor-Id": actorId },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        await subscription.unsubscribe();
      }
      localStorage.removeItem("xieceda.pushUserId");
      setSubscribed(false);
      setMessage(t("push.disabledMessage"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(appPath("/api/push/test"), {
        method: "POST",
        headers: { "X-Actor-Id": actorId }
      });
      const payload = await response.json();
      if (!response.ok || !payload.delivery?.sent) throw new Error(t("push.testFailed"));
      setMessage(t("push.testSent"));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-settings">
      <div>
        <strong>{t("push.title")}</strong>
        <p>{supported ? t("push.description") : t("push.unsupported")}</p>
        {permission === "denied" && <small>{t("push.permissionDenied")}</small>}
        {message && <small>{message}</small>}
      </div>
      {supported && (
        <div className="push-actions">
          {subscribed ? (
            <>
              <button className="button button-secondary" disabled={busy} onClick={sendTest}>
                {t("push.sendTest")}
              </button>
              <button className="button button-ghost" disabled={busy} onClick={disable}>
                {t("push.disable")}
              </button>
            </>
          ) : (
            <button className="button button-primary" disabled={busy || permission === "denied"} onClick={enable}>
              {busy ? t("push.enabling") : t("push.enable")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
