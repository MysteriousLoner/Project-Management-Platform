const CACHE_NAME = "xieceda-shell-v3";
const SCOPE_URL = new URL(self.registration.scope);
const RESOURCE_BASE_URL = new URL(`${SCOPE_URL.pathname.replace(/\/$/, "")}/`, SCOPE_URL.origin);
const APP_SHELL = [
  SCOPE_URL.pathname,
  ...["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"].map(
    (path) => new URL(path, RESOURCE_BASE_URL).pathname
  )
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith(`${RESOURCE_BASE_URL.pathname}api/`)
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match(SCOPE_URL.pathname)))
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Ticket progress changed." };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "协策达", {
      body: payload.body || "Ticket progress changed.",
      icon: new URL("icons/icon-192.png", RESOURCE_BASE_URL).pathname,
      badge: new URL("icons/icon-192.png", RESOURCE_BASE_URL).pathname,
      tag: payload.tag || "xieceda-ticket-update",
      renotify: true,
      data: { url: payload.url || "" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "", SCOPE_URL).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});
