// 세계 이슈 지도 Worker
// - 화면 파일(public/)은 assets가 그대로 내보낸다.
// - 예약 실행(30분마다): GitHub Actions '뉴스 수집' 워크플로를 깨운다.
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/visit" && request.method === "POST") {
      try { return await visit(request, env); } catch (e) { return json({ error: "fail" }, 500); }
    }
    // 점검용: 토큰이 들어 있는지, GitHub이 받아 주는지만 알려 준다(토큰 값은 절대 내보내지 않음)
    if (url.pathname === "/api/cron-check") {
      const out = { hasToken: !!env.GH_TOKEN, cron: "7,37 * * * *" };
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
