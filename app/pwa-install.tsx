"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { appPath, BASE_PATH } from "@/lib/base-path";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const PROMPT_SEEN_KEY = "xieceda.pwaPromptSeen";

export default function PwaInstallPrompt() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(appPath("/sw.js"), { scope: BASE_PATH || "/" }).catch(() => {
        // The app remains usable if service-worker registration is unavailable.
      });
    }

    const mobile =
      window.matchMedia("(max-width: 820px)").matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    // Platform detection is only available after the component mounts in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsIos(ios);

    if (!mobile || standalone || localStorage.getItem(PROMPT_SEEN_KEY)) return;

    const showTimer = window.setTimeout(() => setVisible(true), 1200);
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      localStorage.setItem(PROMPT_SEEN_KEY, "installed");
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(showTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(PROMPT_SEEN_KEY, "dismissed");
    setVisible(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    localStorage.setItem(PROMPT_SEEN_KEY, choice.outcome);
    setVisible(false);
    setInstallEvent(null);
  }

  if (!visible) return null;

  return (
    <div className="pwa-prompt" role="dialog" aria-modal="true" aria-labelledby="pwa-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={appPath("/icons/icon-192.png")} alt="" />
      <div className="pwa-prompt-copy">
        <strong id="pwa-title">{t("pwa.title")}</strong>
        <p>{t("pwa.description")}</p>
        {!installEvent && (
          <small>{t(isIos ? "pwa.iosHelp" : "pwa.genericHelp")}</small>
        )}
      </div>
      <div className="pwa-prompt-actions">
        {installEvent ? (
          <button className="button button-primary" onClick={install}>
            {t("pwa.install")}
          </button>
        ) : (
          <button className="button button-primary" onClick={dismiss}>
            {t("pwa.gotIt")}
          </button>
        )}
        <button className="button button-ghost" onClick={dismiss}>
          {t("pwa.notNow")}
        </button>
      </div>
    </div>
  );
}
