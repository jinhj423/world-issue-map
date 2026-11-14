// 세계 이슈 지도 — 서비스 워커: 설치 요건 + 오프라인에서 마지막 데이터 보여주기
const V = "wim-v6";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "vendor/map.js", "vendor/countries-110m.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (sameOrigin) {
    // 페이지·데이터는 항상 네트워크 우선(뉴스가 10분마다 바뀌므로), 실패하면 캐시
    e.respondWith(
      fetch(req).then(r => {
        const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); return r;
      }).catch(() =>
        caches.match(req).then(m => m || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
      )
    );
  } else {
    // CDN 라이브러리·폰트는 캐시 우선(내용이 고정)
    e.respondWith(
      caches.match(req).then(m => m || fetch(req).then(r => {
        const cp = r.clone(); caches.open(V).then(c => c.put(req, cp)); return r;
      }))
    );
  }
});

// 급상승 알림
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "세계 이슈 지도", {
    body: d.body || "새 소식이 있어요.", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: d.url || "/" }, lang: "ko",
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of ws) { if (new URL(w.url).origin === self.location.origin && "focus" in w) { await w.focus(); if ("navigate" in w) return w.navigate(url); return; } }
    return self.clients.openWindow(url);
  })());
});
