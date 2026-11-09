// 세계 이슈 지도 Worker
// - 화면 파일(public/)은 assets가 그대로 내보낸다.
// - 예약 실행(10분마다): GitHub Actions '뉴스 수집' 워크플로를 깨우고, 급상승 알림을 확인한다.
//   GitHub 자체 예약은 수 시간씩 밀려서, 정확한 Cloudflare 예약으로 대신 깨운다.
//   필요한 비밀값: GH_TOKEN (GitHub fine-grained token, 이 저장소 Actions: Read and write)
// - 검색 유입용 페이지(/c/<나라>/, /about/, /sitemap.xml)는 최신 news.json으로 여기서 그린다(재배포 불필요).
import { countryPage, econPage, aboutPage, sitemap, robots, injectHome } from "./pages.js";

const REPO = "jinhj423/world-issue-map";
const WORKFLOW = "update-news.yml";

// 방문자 수: 브라우저마다 무작위 번호(vid)만 받는다. 이름·IP 등은 저장하지 않는다.
// visits(day, vid) = 하루 한 줄 → 오늘 방문자 / visitors(vid) = 처음 본 날 → 누적 방문자
let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, vid TEXT NOT NULL, PRIMARY KEY (day, vid))"),
    db.prepare("CREATE TABLE IF NOT EXISTS visitors (vid TEXT PRIMARY KEY, first_day TEXT NOT NULL)"),
    // 잘못 분류 신고: 같은 브라우저는 한 기사에 한 번
    db.prepare("CREATE TABLE IF NOT EXISTS reports (u TEXT NOT NULL, vid TEXT NOT NULL, a2 TEXT NOT NULL, t TEXT, at INTEGER NOT NULL, PRIMARY KEY (u, a2, vid))"),
    // 웹 푸시
    db.prepare("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created INTEGER NOT NULL, ok_at INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS push_log (k TEXT PRIMARY KEY, at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS push_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint TEXT NOT NULL, payload TEXT NOT NULL)"),
  ]);
  try { await db.prepare("ALTER TABLE push_subs ADD COLUMN prefs TEXT").run(); } catch (e) { /* 이미 있음 */ }
  tablesReady = true;
}
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDay = () => kstNow().toISOString().slice(0, 10);
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function visit(request, env) {
  if (!env.DB) return json({ error: "no db" }, 503);
  let vid = "";
  try { vid = String((await request.json()).vid || ""); } catch (e) {}
  if (!/^[a-z0-9-]{8,64}$/i.test(vid)) return json({ error: "bad vid" }, 400);
  await ensureTables(env.DB);
  const day = kstDay();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO visits (day, vid) VALUES (?, ?)").bind(day, vid),
    env.DB.prepare("INSERT OR IGNORE INTO visitors (vid, first_day) VALUES (?, ?)").bind(vid, day),
  ]);
  const [t, a] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE day = ?").bind(day),
    env.DB.prepare("SELECT COUNT(*) AS n FROM visitors"),
  ]);
  return json({ today: t.results[0].n, total: a.results[0].n });
}

// ── 데이터: 수집 커밋마다 사이트를 재배포하지 않도록, data 브랜치의 최신 파일을 직접 읽는다 ──
// 1) GitHub API(토큰, 캐시 없음) → 2) raw.githubusercontent.com(최대 5분 캐시) → 3) 배포된 파일
// 같은 Worker 인스턴스 안에서는 60초 동안 재사용한다.
const memo = {};
async function dataFile(name, env, maxAge = 60e3) {
  const m = memo[name];
  if (m && Date.now() - m.at < maxAge) return m;
  const tries = [];
  if (env.GH_TOKEN) tries.push(["api", `https://api.github.com/repos/${REPO}/contents/${name}?ref=data`, {
    Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wnm-site" }]);
  tries.push(["raw", `https://raw.githubusercontent.com/${REPO}/data/${name}`, { "User-Agent": "wnm-site" }]);
  for (const [src, u, headers] of tries) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      const body = await r.text();
      if (!body.startsWith("{")) continue;
      memo[name] = { at: Date.now(), body, src, obj: null };
      return memo[name];
    } catch (e) {}
  }
  if (m) return m; // 실패하면 직전 값
  try { // 그래도 없으면 배포된 파일(오래된 값일 수 있음)
    const r = await env.ASSETS.fetch("https://assets.local/data/" + name);
    if (r.ok) { const body = await r.text(); if (body.startsWith("{")) return (memo[name] = { at: Date.now() - maxAge + 30e3, body, src: "assets", obj: null }); }
  } catch (e) {}
  return null;
}

// 신고가 3건 이상 모인 기사는 그 나라 목록에서 뺀다(5분마다 다시 셈)
let hiddenMemo = { at: 0, set: new Set() };
async function hiddenItems(env) {
  if (!env.DB || Date.now() - hiddenMemo.at < 300e3) return hiddenMemo.set;
  try {
    await ensureTables(env.DB);
    const r = await env.DB.prepare("SELECT u, a2 FROM reports GROUP BY u, a2 HAVING COUNT(*) >= 3").all();
    hiddenMemo = { at: Date.now(), set: new Set((r.results || []).map((x) => x.a2 + "|" + x.u)) };
  } catch (e) { hiddenMemo.at = Date.now(); }
  return hiddenMemo.set;
}

// 최신 뉴스(객체). 신고로 가려진 기사는 빠져 있다.
async function getNews(env) {
  const f = await dataFile("news.json", env);
  if (!f) return null;
  const hidden = await hiddenItems(env);
  const key = f.at + ":" + hidden.size;
  if (f.obj && f.objKey === key) return f.obj;
  const d = JSON.parse(f.body);
  if (hidden.size) {
    for (const [a2, c] of Object.entries(d.countries || {})) {
      if (c.items) c.items = c.items.filter((i) => !hidden.has(a2 + "|" + i.u));
    }
  }
  f.obj = d; f.objKey = key; f.out = hidden.size ? JSON.stringify(d) : f.body;
  return d;
}
const dataResp = (body, src) => new Response(body, {
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-data-source": src },
});

async function report(request, env) {
  if (!env.DB) return json({ error: "no db" }, 503);
  let b = {};
  try { b = await request.json(); } catch (e) {}
  const vid = String(b.vid || ""), u = String(b.u || ""), a2 = String(b.a2 || "").toUpperCase(), t = String(b.t || "").slice(0, 200);
  if (!/^[a-z0-9-]{8,64}$/i.test(vid) || !/^https?:\/\//.test(u) || u.length > 600 || !/^[A-Z]{2}$/.test(a2)) return json({ error: "bad" }, 400);
  await ensureTables(env.DB);
  await env.DB.prepare("INSERT OR IGNORE INTO reports (u, vid, a2, t, at) VALUES (?, ?, ?, ?, ?)")
    .bind(u, vid, a2, t, Math.floor(Date.now() / 1000)).run();
  hiddenMemo.at = 0;
  return json({ ok: true });
}

// ── 웹 푸시 (RFC 8291 aes128gcm + RFC 8292 VAPID). VAPID 키는 처음 필요할 때 만들어 D1 kv에 둔다 ──
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); const b = atob(s + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const te = new TextEncoder();
async function vapidKeys(db) {
  const row = await db.prepare("SELECT v FROM kv WHERE k='vapid'").first();
  if (row) return JSON.parse(row.v);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const v = { jwk: await crypto.subtle.exportKey("jwk", kp.privateKey), pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)) };
  await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('vapid', ?)").bind(JSON.stringify(v)).run();
  return JSON.parse((await db.prepare("SELECT v FROM kv WHERE k='vapid'").first()).v);
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function sendPush(db, keys, sub, payload, site) {
  const uaPub = unb64u(sub.p256dh), auth = unb64u(sub.auth), salt = crypto.getRandomValues(new Uint8Array(16));
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, cat(te.encode(payload), new Uint8Array([2]))));
  const body = cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([65]), asPub, ct);
  const aud = new URL(sub.endpoint).origin;
  const enc = (o) => b64u(te.encode(JSON.stringify(o)));
  const unsigned = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: site });
  const pk = await crypto.subtle.importKey("jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pk, te.encode(unsigned));
  const r = await fetch(sub.endpoint, { method: "POST", body, headers: {
    "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "21600", Urgency: "normal",
    Authorization: `vapid t=${unsigned}.${b64u(sig)}, k=${keys.pub}` } });
  if (r.status === 404 || r.status === 410) { await db.prepare("DELETE FROM push_subs WHERE endpoint=?").bind(sub.endpoint).run(); return "gone"; }
  if (r.ok) await db.prepare("UPDATE push_subs SET ok_at=? WHERE endpoint=?").bind(Math.floor(Date.now() / 1000), sub.endpoint).run();
  return r.ok ? "ok" : "err" + r.status;
}

// 알림 종류(기기마다): 기본값은 급상승·경제·관심 나라 켬, 화제·아침 요약 끔, 밤 조용히 켬
const PUSH_DEFAULT = { surge: true, econ: true, buzz: false, pins: true, morning: false, quiet: true, list: [] };
function cleanPrefs(p) {
  const d = { ...PUSH_DEFAULT, list: [] };
  if (!p || typeof p !== "object") return d;
  for (const k of ["surge", "econ", "buzz", "pins", "morning", "quiet"]) if (typeof p[k] === "boolean") d[k] = p[k];
  if (Array.isArray(p.list)) d.list = p.list.filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 5);
  return d;
}
const readPrefs = (row) => { try { return cleanPrefs(JSON.parse(row.prefs || "null")); } catch (e) { return cleanPrefs(null); } };

async function pushApi(request, env, url) {
  if (!env.DB) return json({ error: "no db" }, 503);
  await ensureTables(env.DB);
  const db = env.DB;
  if (url.pathname === "/api/push/key") return json({ key: (await vapidKeys(db)).pub });
  if (url.pathname === "/api/push/sub" && request.method === "POST") {
    let b = {};
    try { b = await request.json(); } catch (e) {}
    const s = b.sub || {}, k = s.keys || {};
    if (!/^https:\/\//.test(s.endpoint || "") || !k.p256dh || !k.auth || s.endpoint.length > 800) return json({ error: "bad" }, 400);
    await db.prepare("INSERT OR REPLACE INTO push_subs (endpoint, p256dh, auth, created, prefs) VALUES (?, ?, ?, ?, ?)")
      .bind(s.endpoint, k.p256dh, k.auth, Math.floor(Date.now() / 1000), JSON.stringify(cleanPrefs(b.prefs))).run();
    if (b.test) {
      const r = await sendPush(db, await vapidKeys(db), { endpoint: s.endpoint, p256dh: k.p256dh, auth: k.auth },
        JSON.stringify({ title: b.test === "again" ? "테스트 알림이에요" : "알림이 켜졌어요", body: "고른 종류의 큰 소식이 생기면 이렇게 알려 드릴게요.", url: "/", tag: "hello" }), url.origin);
      return json({ ok: true, test: r });
    }
    return json({ ok: true });
  }
  if (url.pathname === "/api/push/prefs") {
    let b = {};
    if (request.method === "POST") { try { b = await request.json(); } catch (e) {} }
    const ep = String(b.endpoint || url.searchParams.get("e") || "");
    const row = ep && await db.prepare("SELECT endpoint, p256dh, auth, prefs FROM push_subs WHERE endpoint=?").bind(ep).first();
    if (!row) return json({ error: "no sub" }, 404);
    if (request.method === "POST") {
      const p = cleanPrefs(b.prefs);
      await db.prepare("UPDATE push_subs SET prefs=? WHERE endpoint=?").bind(JSON.stringify(p), ep).run();
      if (b.test) {
        const r = await sendPush(db, await vapidKeys(db), row, JSON.stringify({ title: "테스트 알림이에요", body: "알림이 잘 와요. 고른 종류의 큰 소식만 알려 드릴게요.", url: "/", tag: "hello" }), url.origin);
        return json({ ok: true, prefs: p, test: r });
      }
      return json({ ok: true, prefs: p });
    }
    return json({ prefs: readPrefs(row) });
  }
  if (url.pathname === "/api/push/sub" && request.method === "DELETE") {
    let b = {};
    try { b = await request.json(); } catch (e) {}
    if (b.endpoint) await db.prepare("DELETE FROM push_subs WHERE endpoint=?").bind(String(b.endpoint)).run();
    return json({ ok: true });
  }
  return json({ error: "not found" }, 404);
}

// 알림 회차(10분마다). 종류마다 하루 한도가 있고, 한 회차에 종류마다 한 건까지만 만든다.
// - surge  급상승 나라: 순위 5위 안 + 평소의 2.5배 이상 + 기사 12건 이상, 같은 나라 24시간 1번, 하루 2번
// - econ   경제·증시 큰 뉴스: 언론 6곳 이상이 다룬 3시간 안 사건, 하루 3번
// - buzz   지금 화제: 언론 8곳 이상이 다룬 3시간 안 사건, 하루 2번
// - pins   관심 나라: 그 나라가 3위 안에 들거나 평소의 2배 이상, 나라마다 하루 1번
// - morning 아침 8시 요약: 하루 1번
// 밤 23~07시는 '밤 조용히'를 켠 기기에 보내지 않는다(아침 요약 제외).
// 무료 요금제 외부 요청 한도(회당 50) 안에서 한 번에 40곳씩 보내고 나머지는 다음 회차로 넘긴다.
const SURGE = 2.5, SURGE_N = 12;
const CAP = { surge: 2, econ: 3, buzz: 2 };
const TOK_RE = /[가-힣A-Za-z0-9]{2,}/g;
const toks = (t) => new Set((String(t).match(TOK_RE) || []).map((x) => x.toLowerCase()));
function sameStory(a, b) { let n = 0; for (const x of a) if (b.has(x)) n++; return n >= 4 || n / (a.size + b.size - n || 1) >= 0.4; }
const hoursAgo = (p) => (p ? (Date.now() - new Date(p).getTime()) / 36e5 : 99);

async function pushTick(env, site) {
  if (!env.DB) return;
  await ensureTables(env.DB);
  const db = env.DB, now = Math.floor(Date.now() / 1000);
  let budget = 40 - await drainQueue(db, 40, site);
  if (budget <= 0) return;
  const subs = ((await db.prepare("SELECT endpoint, prefs FROM push_subs").all()).results || []).map((r) => ({ e: r.endpoint, p: readPrefs(r) }));
  if (!subs.length) return;
  const d = await getNews(env);
  if (!d) return;
  const h = kstNow().getUTCHours(), night = h >= 23 || h < 7, day = kstDay();
  const count = async (kind) => (await db.prepare("SELECT COUNT(*) AS n FROM push_log WHERE k LIKE ?").bind(`day:${day}:${kind}:%`).first())?.n || 0;
  const mark = (k) => db.prepare("INSERT OR REPLACE INTO push_log (k, at) VALUES (?, ?)").bind(k, now);
  const events = []; // {kind, payload, who(sub)->bool, logs:[]}
  const C = d.countries || {};

  // 급상승 나라
  if (await count("surge") < CAP.surge) {
    for (const a2 of (d.ranking || []).slice(0, 5)) {
      const c = C[a2];
      if (!c || !(c.surge >= SURGE) || c.n < SURGE_N || !(c.items || [])[0]) continue;
      const last = await db.prepare("SELECT at FROM push_log WHERE k=?").bind(`c:${a2}`).first();
      if (last && now - last.at < 86400) continue;
      events.push({ kind: "surge", logs: [`c:${a2}`, `day:${day}:surge:${a2}`],
        payload: { title: `지금 급상승: ${c.ko}`, body: `평소의 ${Math.round(c.surge * 10) / 10}배 보도. ${c.items[0].t}`, url: `/c/${a2.toLowerCase()}/`, tag: `surge-${a2}` } });
      break;
    }
  }
  // 경제·증시, 지금 화제: 이미 보낸 사건(24시간)과 같은 이야기면 건너뛴다
  const sentRow = await db.prepare("SELECT v FROM kv WHERE k='topic_sent'").first();
  let sent = []; try { sent = JSON.parse(sentRow?.v || "[]").filter((x) => now - x.at < 86400); } catch (e) {}
  const sentSets = sent.map((x) => toks(x.t));
  for (const [kind, minSc, label, path] of [["econ", 6, "경제·증시", "/econ/"], ["buzz", 8, "지금 화제", "/#buzz"]]) {
    if (await count(kind) >= CAP[kind]) continue;
    const it = ((d[kind] || {}).items || []).find((x) => (x.sc || 1) >= minSc && hoursAgo(x.p) <= 3 && !sentSets.some((s) => sameStory(toks(x.t), s)));
    if (!it) continue;
    sent.push({ t: it.t, at: now }); sentSets.push(toks(it.t));
    events.push({ kind, logs: [`day:${day}:${kind}:${now}`],
      payload: { title: `${label}: 언론 ${it.sc}곳이 다룬 소식`, body: it.t, url: path, tag: `${kind}-${now}` } });
  }
  // 관심 나라
  const pinned = new Set(subs.filter((s) => s.p.pins).flatMap((s) => s.p.list));
  for (const a2 of pinned) {
    const c = C[a2], rank = (d.ranking || []).indexOf(a2) + 1;
    if (!c || !(c.items || [])[0] || !((rank && rank <= 3) || c.surge >= 2)) continue;
    if (await db.prepare("SELECT at FROM push_log WHERE k=?").bind(`pin:${day}:${a2}`).first()) continue;
    events.push({ kind: "pins", a2, logs: [`pin:${day}:${a2}`],
      payload: { title: `관심 나라 ${c.ko}: ${rank && rank <= 3 ? `오늘 ${rank}위` : "평소보다 보도 급증"}`, body: c.items[0].t, url: `/c/${a2.toLowerCase()}/`, tag: `pin-${a2}` } });
    break;
  }
  // 아침 요약
  if (h === 8 && !(await db.prepare("SELECT at FROM push_log WHERE k=?").bind(`morning:${day}`).first())) {
    const top = (d.ranking || []).slice(0, 3).map((a) => C[a]?.ko).filter(Boolean);
    const e1 = ((d.econ || {}).items || [])[0];
    events.push({ kind: "morning", logs: [`morning:${day}`],
      payload: { title: `오늘 아침 세계: ${top.join(", ")}`, body: e1 ? `경제: ${e1.t}` : `${top[0]} 소식이 가장 많아요.`, url: "/", tag: `morning-${day}` } });
  }
  if (!events.length) return;
  const stmts = [];
  for (const ev of events) {
    for (const k of ev.logs) stmts.push(mark(k));
    const pl = JSON.stringify(ev.payload);
    for (const s of subs) {
      if (!s.p[ev.kind]) continue;
      if (ev.kind === "pins" && !s.p.list.includes(ev.a2)) continue;
      if (night && s.p.quiet && ev.kind !== "morning") continue;
      stmts.push(db.prepare("INSERT INTO push_queue (endpoint, payload) VALUES (?, ?)").bind(s.e, pl));
    }
  }
  stmts.push(db.prepare("INSERT OR REPLACE INTO kv (k, v) VALUES ('topic_sent', ?)").bind(JSON.stringify(sent.slice(-40))));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  await drainQueue(db, budget, site);
}
async function drainQueue(db, n, site) {
  if (n <= 0) return 0;
  const rows = (await db.prepare(
    "SELECT q.id, q.payload, s.endpoint, s.p256dh, s.auth FROM push_queue q JOIN push_subs s ON s.endpoint=q.endpoint ORDER BY q.id LIMIT ?"
  ).bind(n).all()).results || [];
  await db.prepare("DELETE FROM push_queue WHERE endpoint NOT IN (SELECT endpoint FROM push_subs)").run();
  if (!rows.length) return 0;
  const keys = await vapidKeys(db);
  for (const r of rows) {
    try { await sendPush(db, keys, r, r.payload, site); } catch (e) {}
    await db.prepare("DELETE FROM push_queue WHERE id=?").bind(r.id).run();
  }
  return rows.length;
}

const html = (body, maxAge = 300) => new Response(body, {
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${maxAge}` },
});
const SITE_FALLBACK = "https://wnm.jinhj423-42b.workers.dev";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/data/news.json") {
      const d = await getNews(env);
      const f = memo["news.json"];
      return d ? dataResp(f.out || f.body, f.src) : json({ error: "no data" }, 503);
    }
    if (p === "/data/archive.json") {
      const f = await dataFile("archive.json", env, 300e3);
      return f ? dataResp(f.body, f.src) : json({ days: {} });
    }
    if (p === "/api/visit" && request.method === "POST") {
      try { return await visit(request, env); } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용(읽기만): 지금 숫자를 기록 없이 돌려준다
    if (p === "/api/visit" && request.method === "GET") {
      try {
        if (!env.DB) return json({ error: "no db" }, 503);
        await ensureTables(env.DB);
        const [t, a, s] = await env.DB.batch([
          env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE day = ?").bind(kstDay()),
          env.DB.prepare("SELECT COUNT(*) AS n FROM visitors"),
          env.DB.prepare("SELECT COUNT(*) AS n FROM push_subs"),
        ]);
        return json({ today: t.results[0].n, total: a.results[0].n, push: s.results[0].n, day: kstDay() });
      } catch (e) { return json({ error: "fail" }, 500); }
    }
    if (p === "/api/report" && request.method === "POST") {
      try { return await report(request, env); } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용: 신고가 많은 기사 목록(제목·링크는 이미 공개된 뉴스)
    if (p === "/api/reports") {
      if (!env.DB) return json({ error: "no db" }, 503);
      await ensureTables(env.DB);
      const r = await env.DB.prepare("SELECT a2, t, u, COUNT(*) AS n, MAX(at) AS last FROM reports GROUP BY u, a2 ORDER BY last DESC LIMIT 50").all();
      return json({ items: r.results || [] });
    }
    if (p.startsWith("/api/push/")) {
      try { return await pushApi(request, env, url); } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용: 토큰이 들어 있는지, GitHub이 받아 주는지만 알려 준다(토큰 값은 절대 내보내지 않음)
    if (p === "/api/cron-check") {
      const out = { hasToken: !!env.GH_TOKEN, cron: "3,13,23,33,43,53 * * * *" };
      if (env.GH_TOKEN) {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`, {
          headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wnm-cron" },
        });
        out.github = r.status; // 200이면 토큰 정상, 401 만료·오타, 404 저장소 권한 없음
      }
      return json(out);
    }
    if (p === "/robots.txt") return new Response(robots(url.origin), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (p === "/sitemap.xml") {
      const d = await getNews(env);
      return new Response(sitemap(url.origin, d), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
    }
    if (p === "/about" || p === "/about/") {
      if (p === "/about") return Response.redirect(url.origin + "/about/", 301);
      return html(aboutPage(url.origin), 3600);
    }
    if (p === "/econ" || p === "/econ/") {
      if (p === "/econ") return Response.redirect(url.origin + "/econ/", 301);
      const d = await getNews(env);
      if (!d) return new Response("잠시 뒤 다시 열어 주세요", { status: 503 });
      return html(econPage(url.origin, d));
    }
    const m = p.match(/^\/c\/([a-z]{2})\/?$/);
    if (m) {
      if (!p.endsWith("/")) return Response.redirect(url.origin + p + "/", 301);
      const d = await getNews(env);
      const a2 = m[1].toUpperCase();
      if (!d || !d.countries[a2]) return new Response("없는 나라예요", { status: 404 });
      const arc = await dataFile("archive.json", env, 300e3);
      let arcObj = null;
      try { arcObj = arc ? JSON.parse(arc.body) : null; } catch (e) {}
      return html(countryPage(url.origin, d, a2, arcObj));
    }
    if (p === "/" || p === "/index.html") {
      const res = await env.ASSETS.fetch(request);
      if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return res;
      const d = await getNews(env);
      return d ? injectHome(res, url.origin, d) : res;
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) {
      console.log("GH_TOKEN이 없어 수집을 깨우지 못했습니다");
    } else {
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GH_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "wnm-cron",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      console.log("수집 깨우기:", r.status, r.status === 204 ? "성공" : await r.text());
    }
    try { await pushTick(env, env.SITE_URL || SITE_FALLBACK); } catch (e) { console.log("알림 확인 실패:", String(e)); }
  },
};
