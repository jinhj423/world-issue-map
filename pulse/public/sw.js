// 월드펄스 서비스 워커 — 앱 설치(홈 화면 추가)와 인터넷이 끊겼을 때 마지막으로 본 화면 보여 주기.
// 화면·자료는 늘 새로 받고(4초 안에 안 오면 저장해 둔 것), 국기·지도·아이콘처럼 거의 안 바뀌는 파일만 저장본을 먼저 쓴다.
const VER = "wp-3";
const CORE = ["/", "/app.css", "/app.js", "/theme.js", "/pwa.js", "/vendor/map.js", "/icon.svg", "/manifest.webmanifest"];
const STATIC = /^\/(flags|vendor|icons)\/|^\/icon\.svg$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function put(req, res) {
  if (res && (res.ok || res.type === "opaque")) {
    const c = await caches.open(VER);
    await c.put(req, res.clone());
  }
  return res;
}

async function fresh(req) {
  const net = fetch(req).then((res) => put(req, res));
  net.catch(() => {}); // 저장본으로 이미 답한 뒤 실패해도 경고를 남기지 않는다
  const late = new Promise((r) => setTimeout(r, 4000)).then(() => caches.match(req));
  try {
    // 먼저 온 쪽을 쓰되, 4초가 지나도 저장본이 없으면 계속 인터넷 응답을 기다린다
    const first = await Promise.race([net, late]);
    if (first) return first;
    return await net;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") return (await caches.match("/")) || Response.error();
    throw err;
  }
}

async function stored(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  return put(req, await fetch(req));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname === "/sw.js") return;
    e.respondWith(STATIC.test(url.pathname) ? stored(req) : fresh(req));
  } else if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(stored(req)); // 글꼴(Pretendard)은 판이 고정된 주소
  }
});
