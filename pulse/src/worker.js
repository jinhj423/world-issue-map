// 월드펄스 Worker — 자료 중계와 서버에서 그리는 페이지(나라·방법과 출처·sitemap).
// 자료: 같은 저장소 pulse-data 브랜치(GitHub Actions '월드펄스 수집'이 15분 단위 GDELT 파일로 만든다).
// 비밀값·D1 없음. 공개 저장소의 raw 주소를 60초 메모해 쓴다.
const REPO = "jinhj423/world-issue-map";
const RAW = `https://raw.githubusercontent.com/${REPO}/pulse-data/`;
const FILES = new Set(["pulse.json", "detail.json", "calendar.json", "news.json", "brief.json"]);
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

const ED = {
  general: { path: "/", h1: "전 세계 언론이 지금 다루는 나라", mapT: "세계 보도 지수", rankT: "지금 많이 다루는 나라", topT: "가장 많이 다룬 나라",
    lead: "최근 24시간 기사 수와 평소 대비 변화로 매긴 0~100 점수입니다.", key: "g", n: "n", r: "r", hk: "h", rank: "general", cats: "general_cats" },
  invest: { path: "/invest/", h1: "시장 관련 보도가 몰린 나라", mapT: "시장 보도 지수", rankT: "시장 보도가 몰린 나라", topT: "시장 보도가 가장 많은 나라",
    lead: "경제·시장·에너지·무역 기사만 세어 매긴 0~100 점수입니다. 투자 권유가 아닙니다.", key: "gi", n: "i", r: "ir", hk: "hi", rank: "invest", cats: "invest_cats" },
};
const flag = (iso, lazy = true) => `<img class="flag" src="/flags/${iso.toLowerCase()}.svg" alt="" width="24" height="18"${lazy ? ' loading="lazy"' : ""}>`;
const upDown = (r) => (r == null ? "" : r >= 1.1 ? "up" : r <= 0.9 ? "down" : "");
const clockKo = (iso) => (iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 ${iso.slice(11, 16)}` : "알 수 없음");

const dd = (d) => `${+d.slice(5, 7)}.${d.slice(8, 10)}`;
const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : "#");
const srcLinks = (src) => (src || []).map(([l, u]) => ` <a class="srcl" href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">${esc(l)}</a>`).join("");

// 무슨 일이 있었나: GDELT 사건 묶음(예시 기사 링크) + 위키백과 주요 사건 중 이 나라 (app.js whatHTML과 같은 모양)
function whatHTML(p, n, iso, det, br) {
  const es = (p.countries[iso] || {}).e || [];
  const ai = br && (br.countries || {})[iso];
  const aiHTML = ai ? `<p class="aisum"><span class="ait">AI 요약</span>${esc(ai.s)}</p>${ai.k && ai.k.length ? `<p class="aik">${ai.k.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</p>` : ""}` : "";
  const ratio = (r, b) => (r == null ? "" : b != null && b < 1 ? "평소엔 거의 없음" : `평소의 ${r.toFixed(1)}배`);
  const chips = es.map(([g, k, r, b]) => `<span class="evc"><b>${esc((p.evk || {})[g] || g)}</b> ${fmt(k)}건${r != null ? ` <i class="${r >= 1.5 ? "up" : r <= 0.67 ? "down" : ""}">${ratio(r, b)}</i>` : ""}</span>`).join("");
  // 사건 종류마다 뜻과 예시 기사(평소의 1.5배 넘게 늘어난 종류만) — 펼쳐 보기
  const exOf = (g) => { const x = ((det && det.ev) || {})[g]; return x ? (Array.isArray(x[0]) ? x : [x]) : []; };
  const evAll = es.length ? `<details class="evall"><summary>사건 종류 뜻과 예시 기사 보기</summary><ul>${es.map(([g, k, r, b]) => `<li><b>${esc((p.evk || {})[g] || g)}</b>: ${esc((p.evd || {})[g] || "")}. 24시간 ${fmt(k)}건${b != null ? `, 평소 약 ${fmt(Math.round(b))}건` : ""}.${exOf(g).map(([u, dom]) => ` <a class="srcl" href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">${esc(dom)}</a>`).join("")}</li>`).join("")}</ul></details>` : "";
  const wl = [];
  for (const d of (n && n.days) || []) for (const it of d.items) if ((it.c || []).includes(iso)) wl.push([d.date, it]);
  if (!ai && !chips && !wl.length) return `<div class="what"><h2 class="subh">무슨 일이 있었나</h2><p class="hint">두드러진 사건이 아직 잡히지 않았습니다.</p></div>`;
  return `<div class="what"><h2 class="subh">무슨 일이 있었나</h2>${aiHTML}${chips ? `<div class="evs">${chips}</div>${evAll}` : ""}${wl.length ? `<ul class="wl">${wl.slice(0, 5).map(([d, it]) => `<li><span class="wd">${dd(d)}</span><span>${it.topic ? `<span class="topic">${esc(it.kp || it.topic)}</span>` : ""}${esc(it.ko || it.text)}${it.ko ? ` <details class="origd"><summary>원문</summary>${esc(it.text)}</details>` : ""}${srcLinks(it.src)}${it.bg ? `<details class="wbg"><summary>배경 보기</summary><p>${esc(it.bgk || it.bg)}</p>${it.wu ? `<a href="${esc(safeUrl(it.wu))}" rel="noopener" target="_blank">위키백과 문서: ${esc(it.wt)}</a>` : ""}</details>` : ""}</span></li>`).join("")}</ul>` : ""}<p class="note">${ai ? `AI 요약은 이 나라를 다룬 기사 제목 ${ai.m}개를 Claude가 읽고 새로 쓴 문장(${String(br.at).slice(11, 16)} 기준)이라 틀릴 수 있습니다. ` : ""}${chips ? "사건 종류는 GDELT가 기사 첫머리 문장을 기계로 분류한 것이라 틀릴 수 있습니다. 숫자는 그 사건을 다룬 기사 수입니다." : ""}${wl.length ? `${chips ? " " : ""}문장은 위키백과 주요 사건(CC BY-SA 4.0)${wl.some(([, it]) => it.ko) ? "을 AI로 옮긴 것" : "의 영어 원문"}입니다.` : ""}</p></div>`;
}

// 선 그래프 경로(app.js line과 같은 계산)
function line(vals, w, h, { area = false, pad = 3, cls = "spk", label = "" } = {}) {
  const n = (vals || []).length;
  if (n < 2) return "";
  const max = Math.max(1, ...vals), min = area ? 0 : Math.min(...vals);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * w).toFixed(1)},${(h - pad - ((v - min) / Math.max(1, max - min)) * (h - pad * 2)).toFixed(1)}`).join("");
  const a = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ${a}>${area ? `<path class="${cls}-ar" d="${d}L${w},${h}L0,${h}Z"/>` : ""}<path class="${cls}" d="${d}"/></svg>`;
}

function surgeOf(p, ed) {
  if (ed === "general") return p.rank.surge || [];
  return Object.keys(p.countries).filter((i) => p.countries[i].ir != null && p.countries[i].ir >= 1.6 && p.countries[i].i >= 50)
    .sort((a, b) => p.countries[b].ir - p.countries[a].ir);
}

function rankRows(p, ed, limit = 12) {
  const e = ED[ed];
  return (p.rank[e.rank] || []).slice(0, limit).map((iso, k) => {
    const c = p.countries[iso], m = p.meta[iso] || {};
    return `<li data-iso="${iso}" aria-selected="${k === 0}"><span class="rn">${k + 1}</span><span class="nm">${flag(iso)}<a href="/c/${iso.toLowerCase()}/">${esc(m.ko || iso)}</a></span><span class="sp">${line(c[e.hk], 64, 24)}</span><span class="ix">${c[e.key]}</span><span class="rt ${upDown(c[e.r])}">${ratioTxt(c[e.r])}</span></li>`;
  }).join("");
}

function kpiTiles(p, ed) {
  const e = ED[ed];
  const nm = (iso) => esc((p.meta[iso] || {}).ko || iso);
  const top = (p.rank[e.rank] || [])[0], sg = surgeOf(p, ed)[0];
  const cats = p[e.cats].map((k) => [k, p.global.c[k] || 0]).sort((a, b) => b[1] - a[1]);
  const who = (iso) => `<button type="button" class="kv" data-iso="${iso}">${flag(iso, false)}<span>${nm(iso)}</span></button>`;
  const txt = (t) => `<span class="kv"><span>${esc(t)}</span></span>`;
  const tc = top && p.countries[top], sc = sg && p.countries[sg];
  const tiles = [
    ["24시간 전 세계 기사", txt(fmt(p.global.n)), ed === "invest" ? `그중 시장·금리 분야 ${fmt(p.global.c.markets)}건` : "GDELT가 모은 영어와 65개 언어 기사"],
    [e.topT, top ? who(top) : txt("없음"), tc ? `${fmt(tc[e.n])}건, 평소의 ${ratioTxt(tc[e.r])}` : "자료를 모으는 중입니다"],
    ["평소보다 가장 크게 늘어난 나라", sg ? who(sg) : txt("아직 없음"), sc ? `평소의 ${ratioTxt(sc[e.r])}, ${fmt(sc[e.n])}건` : "평소의 1.6배를 넘은 곳이 없습니다"],
    ["가장 많이 다룬 분야", txt(cats[0] ? p.cats[cats[0][0]] : "없음"), cats[1] ? `${fmt(cats[0][1])}건, 2위 ${p.cats[cats[1][0]]}` : ""],
  ];
  return tiles.map(([l, v, s]) => `<div class="kpi"><span class="kl">${esc(l)}</span>${v}<span class="ks">${esc(s)}</span></div>`).join("");
}

async function homePage(req, env, ed) {
  const res = await env.ASSETS.fetch(new Request(new URL("/", req.url), { headers: req.headers }));
  const p = await data("pulse.json");
  const e = ED[ed];
  const top = p && p.rank[e.rank] && p.rank[e.rank][0];
  const topName = top ? (p.meta[top] || {}).ko : null;
  const title = ed === "invest" ? "시장 관련 보도가 몰린 나라 | 월드펄스 투자자판" : "전 세계 언론이 지금 다루는 나라 | 월드펄스";
  const desc = topName ? `${clockKo(p.asof)} 기준 ${e.h1.replace(" 나라", "")} 1위는 ${topName}입니다. GDELT 전 세계 기사 수로 15분마다 다시 셉니다.` : e.lead;
  const rw = new HTMLRewriter()
    .on("body", { element(el) { el.setAttribute("data-ed", ed); } })
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", title); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", desc); } })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", new URL(e.path, req.url).href); } })
    .on("#h-board", { element(el) { el.setInnerContent(e.h1); } })
    .on("#h-map", { element(el) { el.setInnerContent(e.mapT); } })
    .on("#h-rank", { element(el) { el.setInnerContent(e.rankT); } })
    .on("#lead", { element(el) { el.setInnerContent(e.lead); } })
    .on(`.tabs a[data-ed="${ed}"]`, { element(el) { el.setAttribute("aria-current", "page"); } })
    .on("#asof", { element(el) { if (p) el.setInnerContent(`${clockKo(p.asof)} 기준`); } })
    .on("#kpis", { element(el) { if (p) el.setInnerContent(kpiTiles(p, ed), { html: true }); } })
    .on("#rank", { element(el) { if (p) el.setInnerContent(rankRows(p, ed), { html: true }); } });
  const out = rw.transform(res);
  const h = new Headers(out.headers);
  h.set("cache-control", "public, max-age=60");
  return new Response(out.body, { status: 200, headers: h });
}

function shell(req, title, desc, body, canonical, status = 200) {
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(new URL(canonical, req.url).href)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta name="theme-color" content="#F5F6F8">
<script>try{document.documentElement.dataset.theme=localStorage.getItem("wp-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}</script>
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/app.css"><script src="/theme.js" defer></script></head><body class="page">
<header class="bar"><a class="brand" href="/"><img src="/icon.svg" alt="" width="30" height="30">월드펄스</a><nav class="tabs" aria-label="판 고르기"><a href="/">일반</a><a href="/invest/">투자자</a></nav><a class="about" href="/about/">방법과 출처</a><button type="button" class="theme" id="theme" aria-label="어두운 화면으로 바꾸기" title="어두운 화면으로 바꾸기"><svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></header>
<main class="wrap">${body}</main>
<footer class="foot"><p>보도량 자료 <a href="https://www.gdeltproject.org/">The GDELT Project</a>. 기사 수와 분야는 GDELT가 분류한 값을 월드펄스가 다시 센 것입니다. 사건 종류 GDELT 사건 자료, 주요 사건 문장 위키백과(CC BY-SA 4.0). 국기 그림 <a href="https://github.com/lipis/flag-icons">flag-icons</a>(MIT), 지도 Natural Earth.</p><p>보도량 통계이며 투자 권유가 아닙니다. <a href="/about/">세는 방법과 출처</a></p></footer>
</body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
}

function bars7(days, vals, asof) {
  const W = 700, H = 150, max = Math.max(1, ...vals), gap = 18, bw = (W - gap * 6) / 7;
  const bars = vals.map((v, i) => {
    const bh = Math.max(2, (v / max) * (H - 8)), x = i * (bw + gap), y = H - bh, r = Math.min(4, bh / 2);
    return `<path class="bar7${i === vals.length - 1 ? " now" : ""}" d="M${x},${H}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H}Z"><title>${days[i]} ${fmt(v)}건</title></path>`;
  }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 7일 날짜별 기사 수: ${vals.map((v, i) => `${days[i].slice(5)} ${fmt(v)}건`).join(", ")}. 마지막 날은 ${asof.slice(11, 16)}까지입니다.">${bars}<line class="gl" x1="0" x2="${W}" y1="${H}" y2="${H}"/></svg></div>
<div class="axis axis7">${days.map((d, i) => `<span>${i === days.length - 1 ? "오늘" : `${+d.slice(8)}일`}</span>`).join("")}</div>`;
}

async function countryPage(req, iso) {
  const [p, d, nws, br] = await Promise.all([data("pulse.json"), data("detail.json"), data("news.json"), data("brief.json")]);
  if (!p) return shell(req, "월드펄스", "자료를 받지 못했습니다.", `<section class="card prose"><h1>자료를 받지 못했습니다</h1><p class="lead">잠시 뒤 다시 열어 주세요.</p></section>`, "/", 503);
  const m = p.meta[iso];
  if (!m) return shell(req, "없는 나라 | 월드펄스", "월드펄스에 없는 나라 코드입니다.", `<section class="card prose"><h1>없는 나라 코드입니다</h1><p class="lead">주소를 확인하거나 <a href="/">전체 순위</a>에서 나라를 골라 주세요.</p></section>`, "/", 404);
  const c = p.countries[iso];
  const name = m.ko;
  const back = `<a class="crumb" href="/?c=${iso}">전체 순위로</a>`;
  if (!c) {
    return shell(req, `${name} | 월드펄스`, `${josa(name, "을", "를")} 다룬 최근 24시간 전 세계 기사 수와 분야`,
      `${back}<section class="card"><div class="dh">${flag(iso, false)}<h1>${esc(name)}</h1></div><p class="dsent">최근 24시간 동안 ${esc(josa(name, "을", "를"))} 다룬 기사가 적어 지수를 매기지 않았습니다.</p></section>`, `/c/${iso.toLowerCase()}/`);
  }
  const gi = p.rank.general.indexOf(iso), ii = p.rank.invest.indexOf(iso);
  const cats = Object.entries(c.c || {}).sort((a, b) => b[1] - a[1]);
  const topCat = cats[0];
  const sent = [
    `${clockKo(p.asof)}까지 24시간 동안 전 세계 언론 기사 ${fmt(c.n)}건이 ${josa(name, "을", "를")} 다뤘습니다.`,
    c.r != null ? `평소 몫대로라면 약 ${fmt(c.b)}건이 나올 시간이라 평소의 ${c.r.toFixed(1)}배입니다.` : `평소 수준은 3일치 자료가 모이면 계산합니다.`,
    topCat ? `가장 많이 다룬 분야는 ${p.cats[topCat[0]]}(${fmt(topCat[1])}건)입니다.` : "",
  ].filter(Boolean).join(" ");
  const det = (d && d.countries && d.countries[iso]) || { p: [], l: [], src: [], a: [] };
  const maxCat = Math.max(1, ...cats.map((x) => x[1]));
  const list = (xs, unit) => xs.length ? `<ol class="plain">${xs.map(([k, v]) => `<li><span>${esc(k)}</span><span class="v">${fmt(v)}${unit}</span></li>`).join("")}</ol>` : `<p class="state">아직 없습니다.</p>`;
  const safe = (u) => (/^https?:\/\//.test(u) ? u : "#");
  const arts = det.a.length ? `<ul class="arts">${det.a.map(([t, u, s, ks]) => `<li><span class="t">${esc(String(t).replace("-", "."))}</span><span class="s"><span class="src">${esc(s)}</span>${ks.length ? `<span class="tags">${ks.slice(0, 3).map((k) => `<span class="tag">${esc(p.cats[k] || k)}</span>`).join("")}</span>` : ""}</span><a href="${esc(safe(u))}" rel="nofollow noopener" target="_blank">원문 보기</a></li>`).join("")}</ul>` : `<p class="state">아직 없습니다.</p>`;
  const h48 = c.h && c.h.length > 1
    ? `<div class="chart">${line(c.h, 700, 150, { area: true, pad: 6, cls: "big", label: `최근 48시간 시간별 기사 수, 가장 많은 시간 ${fmt(Math.max(...c.h))}건` })}</div><div class="axis"><span>48시간 전</span><span>24시간 전</span><span>${p.asof.slice(11, 16)}</span></div>`
    : `<div class="chart"><div class="empty">기사가 적어 시간별 흐름은 그리지 않습니다</div></div>`;
  const body = `${back}
<section class="card">
  <div class="dh">${flag(iso, false)}<h1>${esc(name)}</h1><span class="badge">일반 ${gi >= 0 ? gi + 1 + "위" : "순위 밖"}</span><span class="badge plain">투자자 ${ii >= 0 ? ii + 1 + "위" : "순위 밖"}</span></div>
  <p class="dsent">${esc(sent)}</p>
  ${whatHTML(p, nws, iso, det, br)}
  <div class="dnum">
    <div><span class="dv">${c.g}</span><span class="dl">보도 지수</span></div>
    <div><span class="dv">${fmt(c.n)}</span><span class="dl">24시간 기사${c.b == null ? "" : `, 평소 약 ${fmt(c.b)}건`}</span></div>
    <div><span class="dv">${fmt(c.i)}</span><span class="dl">시장 관련 기사</span></div>
    <div><span class="dv">${c.t == null ? "없음" : c.t.toFixed(1)}</span><span class="dl">논조${c.dt == null ? "" : Math.abs(c.dt) < 0.05 ? ", 평소와 같음" : `, 평소보다 ${c.dt > 0 ? "+" : ""}${c.dt.toFixed(1)}`}</span></div>
  </div>
</section>
<section class="card">
  <div class="det">
    <div>
      <h2 class="subh">최근 48시간 시간별 기사 수</h2>${h48}
      <h2 class="subh gap">최근 7일 기사 수</h2>${bars7(p.days, c.s || [], p.asof)}
    </div>
    <div>
      <h2 class="subh">분야별 기사</h2>
      <ul class="cats">${cats.map(([k, v]) => `<li><span>${esc(p.cats[k])}</span><span class="cb" aria-hidden="true"><i style="width:${((v / maxCat) * 100).toFixed(1)}%"></i></span><span class="cv">${fmt(v)}</span></li>`).join("")}</ul>
      <p class="note">한 기사가 여러 분야에 들 수 있습니다. 논조는 GDELT가 단어로 계산한 평균이며 0보다 작으면 부정적인 단어가 많다는 뜻입니다.</p>
    </div>
  </div>
</section>
<section class="card">
  <div class="extra flat">
    <div><h2 class="subh">많이 나온 인물</h2>${list(det.p, "건")}</div>
    <div><h2 class="subh">많이 나온 장소</h2>${list(det.l, "회")}</div>
    <div><h2 class="subh">많이 다룬 언론</h2>${list(det.src, "건")}</div>
    <div class="artsbox"><h2 class="subh">최근 기사</h2>${arts}<p class="note">기사 제목은 언론사 저작물이라 싣지 않고 원문으로 연결합니다.</p></div>
  </div>
</section>`;
  return shell(req, `${name} 보도 지수 | 월드펄스`, sent.slice(0, 150), body, `/c/${iso.toLowerCase()}/`);
}

function aboutPage(req) {
  const body = `
<section class="card prose">
<h1>방법과 출처</h1>
<p class="lead">월드펄스는 전 세계 언론 기사를 나라별로 세어, 어느 나라가 지금 많이 다뤄지는지 보여 줍니다.</p>
<h2>무엇을 세나요</h2>
<p>GDELT 프로젝트가 15분마다 공개하는 기사 목록(영어 기사와 65개 언어 번역 기사)에서, 본문에 나라가 나온 기사를 셉니다. 한 기사에 여러 나라가 나오면 나라마다 한 번씩 셉니다.</p>
<p>GDELT 파일은 보통 1시간쯤 늦게 올라와서, 화면의 기준 시각도 그만큼 늦습니다. 기준 시각은 두 기사 목록이 모두 들어온 마지막 정시입니다.</p>
<h2>보도 지수</h2>
<p>최근 24시간 기사 수(65%)와 평소 대비 변화(35%)를 합친 0~100 점수입니다. 평소 수준은 지난 7일 동안 전체 기사 중 그 나라 몫의 중앙값으로 계산해, 주말처럼 전체 기사가 줄어드는 날에도 비교가 흔들리지 않게 했습니다.</p>
<p>투자자판은 경제·시장·금리·에너지·무역·제재 분야 기사만 세어 같은 방식으로 계산합니다.</p>
<h2>지도 색</h2>
<p>지도 색은 지수 값이 아니라 나라끼리의 순위입니다. 기사가 있는 나라를 7단계로 나눠 진할수록 위쪽입니다. 기사가 적은 나라는 회색입니다.</p>
<h2>분야와 논조</h2>
<p>분야는 GDELT가 기사에 붙인 주제 코드를 월드펄스가 묶은 것입니다. 한 기사가 여러 분야에 들 수 있습니다.</p>
<p>논조는 GDELT가 기사 단어로 계산한 값의 평균입니다. 0보다 작으면 부정적인 단어가 많다는 뜻이고, 사건의 좋고 나쁨을 판단한 값은 아닙니다.</p>
<h2>무슨 일이 있었나</h2>
<p>나라마다 붙는 사건 종류(교전, 체포·기소, 시위·파업, 협정 서명 등)는 GDELT가 기사 첫머리 문장을 기계로 읽어 분류한 사건 자료를 묶은 것입니다. 숫자는 그 사건을 다룬 기사 수이고, 평소 대비는 지난 7일 동안 전체 사건 중 그 몫의 중앙값과 비교합니다. 기계 분류라 틀리게 잡히는 경우가 있습니다.</p>
<p>"세계에서 있었던 일"은 위키백과 편집자들이 날마다 정리하는 주요 사건(Portal:Current events)을 링크와 서식만 빼고 Claude(AI)로 한국어로 옮긴 것입니다. 기계 번역이라 어색할 수 있어 '원문' 단추로 영어 문장을 함께 보여 줍니다. 이 문장들은 원문과 같은 CC BY-SA 4.0 라이선스를 따릅니다.</p>
<h2>AI 요약</h2>
<p>나라마다 붙는 "AI 요약"은 그 나라를 다룬 기사 제목 표본(최근 24시간, 최대 20개)을 Claude(AI)가 읽고, 지금 무엇이 보도되는지 새로 쓴 한두 문장입니다. 2시간마다 다시 씁니다. 기사 제목 문장은 화면에 옮기지 않으며, AI가 쓴 글이라 틀리거나 빠뜨린 내용이 있을 수 있습니다.</p>
<h2>싣지 않는 것</h2>
<p>기사 제목과 본문은 언론사 저작물이라 싣지 않습니다. 언론사 이름과 원문 주소만 남깁니다.</p>
<h2>출처</h2>
<ul class="plain">
<li><span>보도량·분야·논조·사건 종류</span><a href="https://www.gdeltproject.org/">The GDELT Project</a></li>
<li><span>세계에서 있었던 일</span><a href="https://en.wikipedia.org/wiki/Portal:Current_events">위키백과 Portal:Current events(CC BY-SA 4.0)</a></li>
<li><span>경제 일정</span><span class="v">미국 연준, 경제분석국, 인구조사국, 노동통계국, 한국은행 공개 일정</span></li>
<li><span>지도</span><span class="v">Natural Earth(퍼블릭 도메인), world-atlas</span></li>
<li><span>국기 그림</span><a href="https://github.com/lipis/flag-icons">flag-icons(MIT)</a></li>
</ul>
<h2>주의</h2>
<p>보도량 통계이며 투자 권유가 아닙니다. 기사 수가 많다는 것은 많이 다뤄진다는 뜻일 뿐, 좋고 나쁨을 뜻하지 않습니다.</p>
</section>`;
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
