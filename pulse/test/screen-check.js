// 화면 점검: wrangler dev(기본 http://localhost:8787)에 띄운 월드펄스를 휴대폰·PC 크기로 열어 다듬기 항목을 확인한다.
// 실행: node test/screen-check.js [주소]   (Playwright 필요)
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8787";
let fail = 0;
const ok = (c, m) => { console.log(`${c ? "통과" : "실패"}  ${m}`); if (!c) fail++; };

(async () => {
  const b = await chromium.launch();
  for (const [vw, vh] of [[390, 844], [360, 780], [1440, 900]]) {
    for (const path of ["/", "/invest/"]) {
      const pg = await b.newPage({ viewport: { width: vw, height: vh } });
      await pg.goto(BASE + path, { waitUntil: "networkidle" });
      await pg.waitForTimeout(800);
      const r = await pg.evaluate(() => {
        const m = document.getElementById("map").getBoundingClientRect();
        const pins = [...document.querySelectorAll(".pin span")].map((s) => s.getBoundingClientRect());
        return {
          pins: pins.length,
          out: pins.filter((p) => p.left < m.left - 1 || p.right > m.right + 1).length,
          big: [...document.querySelectorAll(".bl-chip, .evc i")].map((x) => x.textContent).filter((t) => /(\d{2,}|[1-9]\d)\.\d배/.test(t)),
          kpiDup: document.querySelector("#kpis").textContent.includes("가장 크게 늘어난 곳"),
          noFlag: [...document.querySelectorAll(".bl-f")].filter((f) => !f.children.length).length,
        };
      });
      const tag = `${vw}px ${path}`;
      ok(r.pins > 0 && r.out === 0, `${tag} 지도 이름표 ${r.pins}개가 모두 지도 안 (밖 ${r.out})`);
      ok(r.big.length === 0, `${tag} 10배 넘는 배수를 그대로 쓰지 않음 ${JSON.stringify(r.big.slice(0, 3))}`);
      ok(!r.kpiDup, `${tag} 맨 위 요약에 '가장 크게 늘어난 곳' 중복 없음`);
      ok(r.noFlag === 0, `${tag} 브리핑 목록에 빈 국기 칸 없음 (${r.noFlag})`);
      await pg.close();
    }
  }
  // 모바일 앱 하단: html 바탕이 지정돼 있고, 화면 끝까지 그리며 아래 안전 영역을 비운다
  for (const path of ["/", "/c/us/", "/about/"]) {
    for (const scheme of ["light", "dark"]) {
      const pg = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      await pg.goto(BASE + path, { waitUntil: "networkidle" });
      const r = await pg.evaluate(() => ({
        vp: document.querySelector('meta[name="viewport"]').content,
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        tc: document.querySelector('meta[name="theme-color"]').content.toLowerCase(),
        pad: [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((x) => x.cssText.includes("safe-area-inset-bottom")); } catch (e) { return false; } }),
      }));
      const tag = `${path} ${scheme}`;
      ok(r.vp.includes("viewport-fit=cover"), `${tag} viewport-fit=cover`);
      ok(r.html === r.body, `${tag} html 바탕(${r.html}) = body 바탕(${r.body})`);
      ok(r.tc === (scheme === "dark" ? "#0e0e0f" : "#f4f4f3"), `${tag} theme-color ${r.tc}`);
      ok(r.pad, `${tag} 아래 안전 영역 여백`);
      await pg.close();
    }
  }
  // 나라 페이지: 인물 이름 첫 글자 대문자, 최근 기사는 접어 둠
  const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  await pg.goto(BASE + "/c/us/", { waitUntil: "networkidle" });
  const r = await pg.evaluate(() => ({
    lower: [...document.querySelectorAll(".extra > div:nth-child(-n+2) ol.plain li > span:first-child")].map((s) => s.textContent).filter((t) => /(^|\s)[a-z]/.test(t)),
    arts: !!document.querySelector("details.artsd .arts"),
  }));
  ok(r.lower.length === 0, `나라 페이지 인물·장소 소문자 시작 없음 ${JSON.stringify(r.lower.slice(0, 3))}`);
  ok(r.arts, "나라 페이지 최근 기사 목록을 접어 둠");
  await b.close();
  console.log(fail ? `실패 ${fail}건` : "모두 통과");
  process.exit(fail ? 1 : 0);
})();
