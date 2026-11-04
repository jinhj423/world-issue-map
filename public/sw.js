// 세계 이슈 지도 — 서비스 워커: 설치 요건 + 오프라인에서 마지막 데이터 보여주기
const V = "wim-v2";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

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
    // 페이지·데이터는 항상 네트워크 우선(뉴스가 30분마다 바뀌므로), 실패하면 캐시
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
