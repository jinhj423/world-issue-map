// 세계 이슈 지도 Worker
// - 화면 파일(public/)은 assets가 그대로 내보낸다.
// - 예약 실행(30분마다): GitHub Actions '뉴스 수집' 워크플로를 깨운다.
//   GitHub 자체 예약은 수 시간씩 밀려서, 정확한 Cloudflare 예약으로 대신 깨운다.
//   필요한 비밀값: GH_TOKEN (GitHub fine-grained token, 이 저장소 Actions: Read and write)
const REPO = "jinhj423/world-issue-map";
const WORKFLOW = "update-news.yml";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
