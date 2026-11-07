// 세계 이슈 지도 Worker
// - 화면 파일(public/)은 assets가 그대로 내보낸다.
// - 예약 실행(15분마다): GitHub Actions '뉴스 수집' 워크플로를 깨운다.
//   GitHub 자체 예약은 수 시간씩 밀려서, 정확한 Cloudflare 예약으로 대신 깨운다.
//   필요한 비밀값: GH_TOKEN (GitHub fine-grained token, 이 저장소 Actions: Read and write)
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
  ]);
  tablesReady = true;
}
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
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

// 뉴스 데이터: 수집 커밋마다 사이트를 재배포하지 않도록, 저장소의 최신 파일을 직접 읽어 내보낸다.
// 1) GitHub API(토큰, 캐시 없음) → 2) raw.githubusercontent.com(최대 5분 캐시) → 3) 배포된 파일
// 같은 Worker 인스턴스 안에서는 60초 동안 재사용한다.
const DATA_PATH = "public/data/news.json";
let dataMemo = { at: 0, body: null };
async function newsData(request, env) {
  if (dataMemo.body && Date.now() - dataMemo.at < 60e3) return dataResp(dataMemo.body, "memo");
  const tries = [];
  if (env.GH_TOKEN) tries.push(["api", `https://api.github.com/repos/${REPO}/contents/${DATA_PATH}?ref=main`, {
    Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github.raw+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wnm-site" }]);
  tries.push(["raw", `https://raw.githubusercontent.com/${REPO}/main/${DATA_PATH}`, { "User-Agent": "wnm-site" }]);
  for (const [src, u, headers] of tries) {
    try {
      const r = await fetch(u, { headers });
      if (!r.ok) continue;
      const body = await r.text();
      if (!body.startsWith("{")) continue;
      dataMemo = { at: Date.now(), body };
      return dataResp(body, src);
    } catch (e) {}
  }
  return env.ASSETS.fetch(request);
}
const dataResp = (body, src) => new Response(body, {
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-data-source": src },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/data/news.json") return newsData(request, env);
    if (url.pathname === "/api/visit" && request.method === "POST") {
      try { return await visit(request, env); } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용(읽기만): 지금 숫자를 기록 없이 돌려준다
    if (url.pathname === "/api/visit" && request.method === "GET") {
      try {
        if (!env.DB) return json({ error: "no db" }, 503);
        await ensureTables(env.DB);
        const [t, a] = await env.DB.batch([
          env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE day = ?").bind(kstDay()),
          env.DB.prepare("SELECT COUNT(*) AS n FROM visitors"),
        ]);
        return json({ today: t.results[0].n, total: a.results[0].n, day: kstDay() });
      } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용: 토큰이 들어 있는지, GitHub이 받아 주는지만 알려 준다(토큰 값은 절대 내보내지 않음)
    if (url.pathname === "/api/cron-check") {
      const out = { hasToken: !!env.GH_TOKEN, cron: "7,22,37,52 * * * *" };
      if (env.GH_TOKEN) {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}`, {
          headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "wnm-cron" },
        });
        out.github = r.status; // 200이면 토큰 정상, 401 만료·오타, 404 저장소 권한 없음
      }
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (!env.GH_TOKEN) {
      console.log("GH_TOKEN이 없어 수집을 깨우지 못했습니다");
      return;
    }
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
  },
};
// 15분 주기 배포 2026-11-07T07:47:24Z
