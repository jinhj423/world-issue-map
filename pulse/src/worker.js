// 월드펄스 Worker — 자료 중계와 서버에서 그리는 페이지(나라·방법과 출처·sitemap).
// 자료: 같은 저장소 pulse-data 브랜치(GitHub Actions '월드펄스 수집'이 15분 단위 GDELT 파일로 만든다).
// 비밀값·D1 없음. 공개 저장소의 raw 주소를 60초 메모해 쓴다.
const REPO = "jinhj423/world-issue-map";
const RAW = `https://raw.githubusercontent.com/${REPO}/pulse-data/`;
const FILES = new Set(["pulse.json", "detail.json", "calendar.json"]);
const memo = new Map();

let BASE = RAW; // 로컬 시험 때만 env.DATA_BASE로 바꾼다
async function data(name) {
  const hit = memo.get(name);
  if (hit && Date.now() - hit.t < 60_000) return hit.v;
  try {
    const r = await fetch(BASE + name, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (!r.ok) throw new Error(String(r.status));
    const v = await r.json();
    memo.set(name, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (hit) return hit.v;
    return null;
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "없음" : Number(n).toLocaleString("ko-KR"));
const ratioTxt = (r) => (r == null ? "계산 중" : `${r.toFixed(1)}배`);
// 받침에 따라 조사(을/를, 이/가)를 붙인다
const josa = (w, a, b) => { const c = (w || "").charCodeAt((w || "").length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b); };
const hhmm = (iso) => (iso ? iso.slice(5, 16).replace("-", ".").replace("T", " ") : "알 수 없음");

const ED = {
  general: { path: "/", h1: "전 세계 언론이 지금 다루는 나라", lead: "최근 24시간 기사 수와 평소 대비 변화로 매긴 보도 지수입니다.", key: "g", n: "n", r: "r", rank: "general" },
  invest: { path: "/invest/", h1: "시장 관련 보도가 몰린 나라", lead: "경제·시장·에너지·무역 기사만 세어 매긴 지수입니다. 투자 권유가 아닙니다.", key: "gi", n: "i", r: "ir", rank: "invest" },
};

function rankRows(p, ed, limit = 20) {
  const e = ED[ed];
  return (p.rank[e.rank] || []).slice(0, limit).map((iso, k) => {
    const c = p.countries[iso], m = p.meta[iso] || {};
    return `<tr data-iso="${iso}"><td class="num">${k + 1}</td><td><a href="/c/${iso.toLowerCase()}/">${esc(m.ko || iso)}</a></td><td class="num">${c[e.key]}</td><td class="num">${fmt(c[e.n])}</td><td class="num">${ratioTxt(c[e.r])}</td></tr>`;
  }).join("");
}

async function homePage(req, env, ed) {
  const res = await env.ASSETS.fetch(new Request(new URL("/", req.url), { headers: req.headers }));
  const p = await data("pulse.json");
  const e = ED[ed];
  const top = p && p.rank[e.rank] && p.rank[e.rank][0];
  const topName = top ? (p.meta[top] || {}).ko : null;
  const title = ed === "invest" ? "시장 관련 보도가 몰린 나라 | 월드펄스 투자자판" : "전 세계 언론이 지금 다루는 나라 | 월드펄스";
  const desc = topName ? `${hhmm(p.asof)} 기준 ${e.h1.replace(" 나라", "")} 1위는 ${topName}입니다. GDELT 전 세계 기사 수로 15분마다 다시 셉니다.` : e.lead;
  const rw = new HTMLRewriter()
    .on("body", { element(el) { el.setAttribute("data-ed", ed); } })
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", new URL(e.path, req.url).href); } })
    .on("#h-board", { element(el) { el.setInnerContent(e.h1); } })
    .on("#lead", { element(el) { el.setInnerContent(e.lead); } })
    .on(`.eds a[data-ed="${ed}"]`, { element(el) { el.setAttribute("aria-current", "page"); } })
    .on("#asof", { element(el) { if (p) el.setInnerContent(`GDELT ${hhmm(p.asof)} 기준`); } })
    .on("#rank-body", { element(el) { if (p) el.setInnerContent(rankRows(p, ed), { html: true }); } });
  const out = rw.transform(res);
  const h = new Headers(out.headers);
  h.set("cache-control", "public, max-age=60");
  return new Response(out.body, { status: 200, headers: h });
}

function shell(req, title, desc, body, canonical) {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(new URL(canonical, req.url).href)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Martian+Mono:wdth,wght@75..112.5,400..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/app.css"></head><body class="page">
<header class="bar"><a class="mark" href="/" aria-label="월드펄스 처음으로">월드펄스</a><nav class="eds" aria-label="판 선택"><a href="/">일반</a><a href="/invest/">투자자</a></nav><a class="about" href="/about/">방법과 출처</a></header>
<main class="wrap page-main">${body}</main>
<footer class="foot"><p>보도량 자료: <a href="https://www.gdeltproject.org/">The GDELT Project</a>. 기사 수와 분야는 GDELT가 분류한 값을 월드펄스가 다시 센 것입니다.</p><p>투자 권유가 아닙니다. 보도량 통계입니다.</p></footer>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
}

function bars7(days, vals, today) {
  const w = 336, h = 120, max = Math.max(1, ...vals), bw = 24, gap = (w - bw * 7) / 6;
  const rects = vals.map((v, i) => {
    const bh = Math.round((v / max) * (h - 28));
    const x = Math.round(i * (bw + gap));
    const cls = i === vals.length - 1 ? "b-now" : "b";
    return `<rect class="${cls}" x="${x}" y="${h - 20 - bh}" width="${bw}" height="${bh}"><title>${days[i]} ${fmt(v)}건</title></rect><text class="ax" x="${x + bw / 2}" y="${h - 4}" text-anchor="middle">${days[i].slice(8)}</text>`;
  }).join("");
  return `<svg class="bars7" viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 7일 날짜별 기사 수, 마지막 날은 ${today}까지">${rects}</svg>`;
}

async function countryPage(req, iso) {
  const [p, d] = await Promise.all([data("pulse.json"), data("detail.json")]);
  if (!p) return shell(req, "월드펄스", "자료를 받지 못했습니다.", `<h1>자료를 받지 못했습니다</h1><p>잠시 뒤 다시 열어 주세요.</p>`, "/");
  const m = p.meta[iso];
  if (!m) return new Response("없는 나라 코드입니다.", { status: 404 });
  const c = p.countries[iso];
  const name = m.ko;
  if (!c) {
    return shell(req, `${name} | 월드펄스`, `${josa(name, "을", "를")} 다룬 최근 24시간 전 세계 기사 수와 분야`,
      `<h1>${esc(name)}</h1><p class="lead">최근 24시간 동안 ${esc(josa(name, "을", "를"))} 다룬 기사가 적어 지수를 매기지 않았습니다.</p><p><a href="/">전체 순위 보기</a></p>`, `/c/${iso.toLowerCase()}/`);
  }
  const gi = p.rank.general.indexOf(iso), ii = p.rank.invest.indexOf(iso);
  const cats = Object.entries(c.c || {}).sort((a, b) => b[1] - a[1]);
  const topCat = cats[0];
  const sent = [
    `${hhmm(p.asof)}까지 24시간 동안 전 세계 언론 기사 ${fmt(c.n)}건이 ${josa(name, "을", "를")} 다뤘습니다.`,
    c.r != null ? `평소 몫대로라면 약 ${fmt(c.b)}건이 나올 시간이라 평소의 ${c.r.toFixed(1)}배입니다.` : `평소 수준은 3일치 자료가 모이면 계산합니다.`,
    topCat ? `가장 많이 다룬 분야는 ${p.cats[topCat[0]]}(${fmt(topCat[1])}건)입니다.` : "",
  ].filter(Boolean).join(" ");
  const det = (d && d.countries && d.countries[iso]) || { p: [], l: [], src: [], a: [] };
  const maxCat = Math.max(1, ...cats.map((x) => x[1]));
  const catRows = cats.map(([k, v]) => `<tr><th scope="row">${esc(p.cats[k])}</th><td class="num">${fmt(v)}</td><td class="barcell"><span class="hbar" style="--v:${(v / maxCat).toFixed(3)}"></span></td></tr>`).join("");
  const list = (xs, unit) => xs.length ? `<ol class="plain">${xs.map(([k, v]) => `<li><span>${esc(k)}</span><span class="num muted">${fmt(v)}${unit}</span></li>`).join("")}</ol>` : `<p class="muted">아직 없습니다.</p>`;
  const arts = det.a.length ? `<ul class="arts">${det.a.map(([t, u, s, ks, tone]) => `<li><span class="num muted">${esc(t)}</span><span>${esc(s)}</span><span class="tags">${ks.map((k) => `<span class="tag">${esc(p.cats[k])}</span>`).join("")}</span><a href="${esc(u)}" rel="nofollow noopener" target="_blank">원문</a></li>`).join("")}</ul>` : `<p class="muted">아직 없습니다.</p>`;
  const body = `
<nav class="crumb" aria-label="위치"><a href="/">전체 순위</a></nav>
<h1>${esc(name)}</h1>
<p class="lead">${esc(sent)}</p>
<dl class="figs">
  <div><dt>보도 지수</dt><dd class="figure">${c.g}</dd><dd class="muted">일반 ${gi >= 0 ? gi + 1 + "위" : "순위 밖"}</dd></div>
  <div><dt>24시간 기사</dt><dd class="figure">${fmt(c.n)}</dd><dd class="muted">평소 ${c.b == null ? "계산 중" : "약 " + fmt(c.b) + "건"}</dd></div>
  <div><dt>시장 관련 기사</dt><dd class="figure">${fmt(c.i)}</dd><dd class="muted">투자자판 ${ii >= 0 ? ii + 1 + "위" : "순위 밖"}</dd></div>
  <div><dt>논조</dt><dd class="figure">${c.t == null ? "없음" : c.t.toFixed(1)}</dd><dd class="muted">${c.dt == null ? "평소 값 계산 중" : `평소보다 ${c.dt > 0 ? "+" : ""}${c.dt.toFixed(1)}`}</dd></div>
</dl>
<section class="blk"><h2>최근 7일 기사 수</h2>${bars7(p.days, c.s, hhmm(p.asof))}</section>
<section class="blk"><h2>분야별 기사 수</h2><table class="cats"><thead><tr><th scope="col">분야</th><th scope="col">기사</th><th scope="col"><span class="visually-hidden">비율</span></th></tr></thead><tbody>${catRows}</tbody></table><p class="muted note">한 기사가 여러 분야에 들 수 있습니다.</p></section>
<div class="cols3">
<section class="blk"><h2>많이 나온 인물</h2>${list(det.p, "건")}</section>
<section class="blk"><h2>많이 나온 장소</h2>${list(det.l, "회")}</section>
<section class="blk"><h2>많이 다룬 언론</h2>${list(det.src, "건")}</section>
</div>
<section class="blk"><h2>최근 기사</h2>${arts}<p class="muted note">기사 제목은 언론사 저작물이라 싣지 않고 원문으로 연결합니다.</p></section>`;
  return shell(req, `${name} 보도 지수 | 월드펄스`, sent.slice(0, 150), body, `/c/${iso.toLowerCase()}/`);
}

function aboutPage(req) {
  const body = `
<h1>방법과 출처</h1>
<p class="lead">월드펄스는 전 세계 언론 기사를 나라별로 세어, 어느 나라가 지금 많이 다뤄지는지 보여 줍니다.</p>
<section class="blk"><h2>무엇을 세나요</h2>
<p>GDELT 프로젝트가 15분마다 공개하는 기사 목록(영어 기사와 65개 언어 번역 기사)에서, 본문에 나라가 나온 기사를 셉니다. 한 기사에 여러 나라가 나오면 나라마다 한 번씩 셉니다.</p>
<p>GDELT 파일은 보통 1시간쯤 늦게 올라와서, 화면의 기준 시각도 그만큼 늦습니다.</p></section>
<section class="blk"><h2>보도 지수</h2>
<p>최근 24시간 기사 수(65%)와 평소 대비 변화(35%)를 합친 0~100 점수입니다. 평소 수준은 지난 7일 하루 기사 수의 중앙값이며, 7일치가 모이기 전에는 변화 몫을 중간값으로 둡니다.</p>
<p>투자자판은 경제·시장·금리·에너지·무역·제재 분야 기사만 세어 같은 방식으로 계산합니다.</p></section>
<section class="blk"><h2>분야와 논조</h2>
<p>분야는 GDELT가 기사에 붙인 주제 코드를 월드펄스가 묶은 것입니다. 한 기사가 여러 분야에 들 수 있습니다.</p>
<p>논조는 GDELT가 기사 단어로 계산한 값의 평균입니다. 0보다 작으면 부정적인 단어가 많다는 뜻이고, 사건의 좋고 나쁨을 판단한 값은 아닙니다.</p></section>
<section class="blk"><h2>싣지 않는 것</h2>
<p>기사 제목과 본문은 언론사 저작물이라 싣지 않습니다. 언론사 이름과 원문 주소만 남깁니다.</p></section>
<section class="blk"><h2>출처</h2>
<ul class="plain">
<li><span>보도량·분야·논조</span><a href="https://www.gdeltproject.org/">The GDELT Project</a></li>
<li><span>경제 일정</span><span>미국 연방준비제도, 경제분석국(BEA), 인구조사국(Census), 노동통계국(BLS), 한국은행 공개 일정</span></li>
<li><span>지도</span><span>Natural Earth(퍼블릭 도메인), world-atlas</span></li>
</ul></section>
<section class="blk"><h2>주의</h2><p>보도량 통계이며 투자 권유가 아닙니다. 기사 수가 많다는 것은 많이 다뤄진다는 뜻일 뿐, 좋고 나쁨을 뜻하지 않습니다.</p></section>`;
  return shell(req, "방법과 출처 | 월드펄스", "월드펄스가 기사를 세는 방법, 보도 지수 계산, 자료 출처", body, "/about/");
}

async function sitemap(req) {
  const p = await data("pulse.json");
  const o = new URL(req.url).origin;
  const urls = ["/", "/invest/", "/about/", ...(p ? Object.keys(p.countries).map((i) => `/c/${i.toLowerCase()}/`) : [])];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${o}${u}</loc></url>`).join("")}</urlset>`, { headers: { "content-type": "application/xml" } });
}

export default {
  async fetch(req, env) {
    if (env.DATA_BASE) BASE = env.DATA_BASE;
    const url = new URL(req.url);
    const path = url.pathname;
    if (path.startsWith("/data/")) {
      const name = path.slice(6);
      if (!FILES.has(name)) return new Response("not found", { status: 404 });
      const v = await data(name);
      if (!v) return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(v), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" } });
    }
    if (path === "/" || path === "/index.html") return homePage(req, env, "general");
    if (path === "/invest" || path === "/invest/") return homePage(req, env, "invest");
    const m = path.match(/^\/c\/([a-z]{2})\/?$/);
    if (m) return countryPage(req, m[1].toUpperCase());
    if (path === "/about" || path === "/about/") return aboutPage(req);
    if (path === "/sitemap.xml") return sitemap(req);
    if (path === "/robots.txt") return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    return env.ASSETS.fetch(req);
  },
};
