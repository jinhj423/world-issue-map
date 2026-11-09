// 검색 유입용 페이지: 서버에서 그린 HTML(검색엔진이 자바스크립트 없이 읽을 수 있게).
// 데이터 출처: 수집된 news.json(Google News RSS 헤드라인·링크), archive.json(날마다 상위 5개 나라).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOGO = `<svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#3182F6"/><g fill="none" stroke="#fff" stroke-width="2"><circle cx="16" cy="17" r="8"/><ellipse cx="16" cy="17" rx="3.5" ry="8"/><path d="M8.3 14.3h15.4M8.3 19.7h15.4"/></g><circle cx="23" cy="9" r="3.4" fill="#FF5D52" stroke="#3182F6" stroke-width="1.8"/></svg>`;
const THEME = `<script>(function(){var t=null;try{t=localStorage.getItem("wim-theme")}catch(e){}var m=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)");document.documentElement.dataset.theme=t||(m&&m.matches?"dark":"light")})();</script>`;
const REGIONS = ["아시아", "중동", "유럽", "미주", "아프리카", "오세아니아"];

function hm(p) {
  if (!p) return "";
  if (p.length <= 10) { const [, m, d] = p.split("-"); return `${+m}.${+d}`; }
  const [d, t] = p.split("T");
  const [, mo, da] = d.split("-");
  return `${+mo}.${+da} ${t.slice(0, 5)}`;
}
function shell({ origin, path, title, desc, body, ogTitle, jsonld }) {
  const url = origin + path;
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="세계 이슈 지도">
<meta property="og:title" content="${esc(ogTitle || title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${origin}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#17191E">
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" href="/icons/icon-192.png">
${THEME}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/page.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>` : ""}
</head><body><div class="wrap">
<header class="top"><a class="brand" href="/">${LOGO}세계 이슈 지도</a><a class="go" href="/">지도 열기</a></header>
<main>${body}</main>
<footer><p class="visits" id="visits" hidden></p><p>뉴스 출처: Google News RSS. 헤드라인을 누르면 언론사 원문으로 이동해요.</p><p><a href="/econ/">오늘의 경제·증시 뉴스</a></p><p><a href="/about/">소개, 개인정보, 문의</a></p></footer>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>
(function(){var v=null;try{v=localStorage.getItem("wim-vid");if(!v){v=(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,12));localStorage.setItem("wim-vid",v)}}catch(e){}
if(!v)return;fetch("/api/visit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({vid:v})}).then(function(r){return r.ok?r.json():null}).then(function(x){if(!x)return;var el=document.getElementById("visits");el.innerHTML="오늘 방문 <b>"+x.today.toLocaleString("ko-KR")+"</b>명, 누적 <b>"+x.total.toLocaleString("ko-KR")+"</b>명";el.hidden=false}).catch(function(){})})();
document.addEventListener("click",async function(e){var b=e.target.closest("[data-share]");if(!b)return;var u=location.href.split("#")[0],t=document.title;
try{if(navigator.share){await navigator.share({title:t,url:u});return}await navigator.clipboard.writeText(u);var o=document.getElementById("toast");o.textContent="링크를 복사했어요";o.classList.add("on");setTimeout(function(){o.classList.remove("on")},1800)}catch(x){}});
</script>
</body></html>`;
}

function countryLinks(d, current) {
  const byR = {};
  for (const [a2, c] of Object.entries(d.countries)) (byR[c.region] ||= []).push([a2, c]);
  return REGIONS.filter((r) => byR[r]).map((r) =>
    `<h3 class="region">${esc(r)}</h3><ul class="chips">${byR[r].sort((a, b) => (b[1].heat || 0) - (a[1].heat || 0))
      .map(([a2, c]) => `<li><a href="/c/${a2.toLowerCase()}/"${a2 === current ? ' aria-current="page"' : ""}>${esc(c.ko)}<span class="n">${c.n || 0}</span></a></li>`).join("")}</ul>`
  ).join("");
}

export function countryPage(origin, d, a2, arc) {
  const c = d.countries[a2], CAT = d.categories || {};
  const rank = (d.ranking || []).indexOf(a2) + 1;
  const items = (c.items || []).slice(0, 20);
  const top = items[0];
  const surge = c.surge != null ? (c.surge >= 1.3 ? `평소보다 ${Math.round((c.surge - 1) * 100)}% 많음` : c.surge <= 0.7 ? "평소보다 적음" : "평소와 비슷") : "";
  const kw = (c.kw || []).slice(0, 8);
  const facts = [
    rank ? `<li class="${rank <= 3 ? "hot" : ""}"><b>${rank}위</b>오늘 순위</li>` : "",
    `<li><b>${c.n || 0}건</b>최근 24시간 기사</li>`,
    surge ? `<li class="${c.surge >= 1.3 ? "hot" : ""}"><b>${esc(surge)}</b>평소 대비</li>` : "",
    c.cat && c.cat !== "etc" && CAT[c.cat] ? `<li><b>${esc(CAT[c.cat])}</b>가장 많은 분야</li>` : "",
  ].join("");
  // 지난 7일 순위(archive)
  let week = "";
  if (arc && arc.days) {
    const rows = Object.keys(arc.days).sort().slice(-7).map((day) => {
      const t = arc.days[day].top || [];
      const i = t.findIndex((x) => x.a2 === a2);
      return { day, r: i >= 0 ? i + 1 : 0, heat: i >= 0 ? t[i].heat : 0 };
    });
    if (rows.some((x) => x.r)) {
      week = `<section class="card"><h2>지난 7일, 상위 5위 안에 든 날</h2><p class="sub">날마다 마지막 집계 기준이에요. 막대는 이슈 지수(0~100)예요.</p>
<ul class="days">${rows.map((x) => `<li class="${x.r === 1 ? "top1" : ""}"><span class="d">${hm(x.day)}</span><span class="bar"><i style="width:${x.heat || 0}%"></i></span><span class="r">${x.r ? x.r + "위" : "밖"}</span></li>`).join("")}</ul></section>`;
    }
  }
  const li = (i) => `<li><a href="${esc(i.u)}" target="_blank" rel="noopener nofollow">${esc(i.t)}</a>
<div class="meta"><span>${esc(i.s)}</span>${i.p ? `<span>${hm(i.p)}</span>` : ""}${i.sc > 1 ? `<span class="ok">언론 ${i.sc}곳 보도</span>` : ""}${CAT[i.c] ? `<span>${esc(CAT[i.c])}</span>` : ""}</div></li>`;
  const list = items.slice(0, 8).map(li).join("");
  const rest = items.length > 8 ? `<details class="more"><summary>헤드라인 ${items.length - 8}개 더 보기</summary><ol class="list" start="9">${items.slice(8).map(li).join("")}</ol></details>` : "";
  const local = (c.local || []).slice(0, 10).map((i) => `<li><a href="${esc(i.u)}" target="_blank" rel="noopener nofollow">${esc(i.t)}</a>
<div class="meta"><span>${esc(i.s)}</span>${i.p ? `<span>${hm(i.p)}</span>` : ""}</div></li>`).join("");
  const body = `
<p class="crumb"><a href="/">세계 이슈 지도</a> / ${esc(c.region)}</p>
<h1>${esc(c.ko)} 오늘의 주요 뉴스</h1>
<p class="lead">${top ? `지금 가장 많이 다뤄진 소식은 "${esc(top.t)}"예요.` : "최근 24시간 동안 모인 기사가 없어요."} ${hm(d.updated_at)} 기준으로 모았어요.</p>
<ul class="facts">${facts}</ul>
<div class="acts"><a class="btn pri" href="/#${a2}">지도에서 보기</a><button type="button" class="btn sec" data-share>공유하기</button></div>
${kw.length ? `<section class="card"><h2>많이 나온 말</h2><ul class="kw">${kw.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></section>` : ""}
<section class="card"><h2>한국어 헤드라인</h2><p class="sub">같은 사건을 여러 언론이 다룬 기사가 위로 와요.</p><ol class="list">${list || "<li>아직 기사가 없어요.</li>"}</ol>${rest}</section>
${local ? `<section class="card"><details class="fold"><summary><h2>현지 언론 1면</h2></summary><p class="sub">그 나라 구글 뉴스 판의 주요 기사예요.</p><ol class="list">${local}</ol></details></section>` : ""}
${week}
<section class="card"><h2>지금 뜨거운 다른 나라</h2><p class="sub">숫자는 최근 24시간 기사 수예요.</p>
<ul class="chips">${(d.ranking || []).filter((x) => x !== a2).slice(0, 10).map((x) => `<li><a href="/c/${x.toLowerCase()}/">${esc(d.countries[x].ko)}<span class="n">${d.countries[x].n || 0}</span></a></li>`).join("")}<li><a href="/econ/">경제·증시</a></li></ul>
<details class="fold" style="margin-top:16px"><summary><span class="region" style="margin:0">모든 나라 보기</span></summary>${countryLinks(d, a2)}</details></section>`;
  const title = `${c.ko} 뉴스 오늘, 실시간 주요 헤드라인 | 세계 이슈 지도`;
  const desc = top ? `${c.ko} 관련 최근 24시간 기사 ${c.n}건. 지금 1위 소식: ${top.t}` : `${c.ko} 관련 최근 24시간 뉴스를 한국어로 모아 봅니다.`;
  return shell({
    origin, path: `/c/${a2.toLowerCase()}/`, title, desc, body,
    ogTitle: rank && rank <= 10 ? `${c.ko}, 오늘 세계 이슈 ${rank}위` : `${c.ko} 오늘의 주요 뉴스`,
    jsonld: {
      "@context": "https://schema.org", "@type": "CollectionPage", name: `${c.ko} 오늘의 주요 뉴스`, inLanguage: "ko",
      dateModified: d.updated_at, url: `${origin}/c/${a2.toLowerCase()}/`,
      isPartOf: { "@type": "WebSite", name: "세계 이슈 지도", url: origin + "/" },
    },
  });
}

export function econPage(origin, d) {
  const e = d.econ || { items: [], kw: [] }, CAT = d.categories || {};
  const items = (e.items || []).slice(0, 30);
  const eli = (i) => `<li><a href="${esc(i.u)}" target="_blank" rel="noopener nofollow">${esc(i.t)}</a>
<div class="meta"><span>${esc(i.s)}</span>${i.p ? `<span>${hm(i.p)}</span>` : ""}${i.sc > 1 ? `<span class="ok">언론 ${i.sc}곳 보도</span>` : ""}</div></li>`;
  const list = items.slice(0, 12).map(eli).join("");
  const rest = items.length > 12 ? `<details class="more"><summary>${items.length - 12}개 더 보기</summary><ol class="list" start="13">${items.slice(12).map(eli).join("")}</ol></details>` : "";
  const econCountries = (d.ranking || []).map((a2) => [a2, d.countries[a2]])
    .map(([a2, c]) => [a2, c, (c.items || []).filter((i) => i.c === "economy")])
    .filter(([, , xs]) => xs.length).sort((a, b) => b[2].length - a[2].length).slice(0, 8);
  const body = `
<p class="crumb"><a href="/">세계 이슈 지도</a> / 경제·증시</p>
<h1>오늘의 경제·증시 뉴스</h1>
<p class="lead">증시, 환율, 금리, 기업 실적처럼 나라 이름이 없는 경제 뉴스까지 모았어요. 여러 언론이 함께 다룬 소식이 위로 와요. ${hm(d.updated_at)} 기준이에요.</p>
${(e.kw || []).length ? `<section class="card"><h2>지금 경제 키워드</h2><ul class="kw">${e.kw.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></section>` : ""}
<section class="card"><h2>많이 다뤄진 경제 뉴스</h2><p class="sub">최근 24시간, 같은 사건은 하나로 묶었어요.</p><ol class="list">${list || "<li>아직 모인 기사가 없어요.</li>"}</ol>${rest}</section>
${econCountries.length ? `<section class="card"><h2>나라별 경제 뉴스</h2><ul class="chips">${econCountries.map(([a2, c, xs]) => `<li><a href="/c/${a2.toLowerCase()}/">${esc(c.ko)}<span class="n">${xs.length}</span></a></li>`).join("")}</ul></section>` : ""}
<div class="acts"><a class="btn pri" href="/">지도에서 보기</a><button type="button" class="btn sec" data-share>공유하기</button></div>`;
  return shell({
    origin, path: "/econ/", title: "오늘 경제 뉴스, 증시·환율·금리 주요 헤드라인 | 세계 이슈 지도",
    desc: items[0] ? `오늘 가장 많이 다뤄진 경제 소식: ${items[0].t}` : "증시·환율·금리·기업 실적 뉴스를 한곳에 모아 봅니다.",
    ogTitle: "오늘의 경제·증시 뉴스", body,
  });
}

export function aboutPage(origin) {
  const body = `
<p class="crumb"><a href="/">세계 이슈 지도</a> / 소개</p>
<h1>세계 이슈 지도 소개</h1>
<p class="lead">56개 나라의 오늘 뉴스를 한국어 헤드라인으로 모아, 지도와 순위로 보여 주는 무료 사이트예요.</p>
<section class="card prose"><h2>어떻게 모으나요</h2>
<p>10분마다 구글 뉴스 RSS에서 나라 이름이 제목에 들어간 한국어 기사와, 각 나라 구글 뉴스 판의 1면 기사를 가져와요. 분류와 순위는 정해 둔 규칙으로 자동 계산하고, 사람이 고르거나 AI가 쓰지 않아요.</p>
<p>순위는 최근 24시간 보도량(60%)과 평소 대비 늘어난 정도(40%)를 섞은 이슈 지수로 매겨요. 같은 사건을 서로 다른 언론 두 곳 이상이 다루면 "언론 N곳 보도"로 표시하고 위로 올려요.</p>
<p>기사 본문은 저장하지 않고 제목과 원문 링크만 보여 줘요. 원문은 각 언론사에 있어요.</p></section>
<section class="card prose"><h2>개인정보</h2>
<ul><li>방문자 수를 세려고 브라우저마다 무작위 번호 하나를 만들어 저장해요. 이름, 이메일, IP 주소는 저장하지 않아요.</li>
<li>알림을 켜면 브라우저가 주는 알림 주소와 고른 알림 종류(관심 나라 포함)만 저장해요. 알림을 끄면 지워요.</li>
<li>"잘못 분류" 신고는 신고한 기사 링크와 위의 무작위 번호만 남겨요. 같은 기사에 신고가 3건 모이면 그 나라 목록에서 빠져요.</li>
<li>화면 설정(다크 모드, 관심 나라)은 이 기기에만 저장돼요.</li></ul></section>
<section class="card prose"><h2>문의</h2>
<p>오류나 제안은 <a href="https://github.com/jinhj423/world-issue-map/issues" target="_blank" rel="noopener">GitHub 이슈</a>로 남겨 주세요.</p></section>`;
  return shell({ origin, path: "/about/", title: "소개, 개인정보, 문의 | 세계 이슈 지도", desc: "세계 이슈 지도가 뉴스를 모으고 순위를 매기는 방법, 개인정보 처리, 문의 방법.", body });
}

export function sitemap(origin, d) {
  const lm = d && d.updated_at ? d.updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const urls = [[origin + "/", "hourly", "1.0"], [origin + "/econ/", "hourly", "0.9"], [origin + "/about/", "monthly", "0.3"]];
  if (d) for (const a2 of Object.keys(d.countries)) urls.push([`${origin}/c/${a2.toLowerCase()}/`, "hourly", "0.8"]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, f, p]) => `<url><loc>${esc(u)}</loc><lastmod>${lm}</lastmod><changefreq>${f}</changefreq><priority>${p}</priority></url>`).join("\n")}
</urlset>`;
}
export const robots = (origin) => `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;

// 메인 화면: 공유 미리보기 문구를 오늘 1위로 바꾼다.
export function injectHome(res, origin, d) {
  const r = d.ranking || [], C = d.countries;
  const c1 = C[r[0]], it = c1 && (c1.items || [])[0];
  const ogT = c1 ? `오늘 세계에서 가장 시끄러운 나라: ${c1.ko}` : "세계 이슈 지도";
  const ogD = it ? `${it.t}. ${Object.values(C).filter((c) => c.n).length}개국 뉴스를 지도와 순위로 봐요.` : "56개국 뉴스를 한국어 헤드라인으로.";
  const setAttr = (v) => ({ element(e) { e.setAttribute("content", v); } });
  return new HTMLRewriter()
    .on('meta[property="og:title"]', setAttr(ogT))
    .on('meta[property="og:description"]', setAttr(ogD))
    .on('meta[name="twitter:card"]', setAttr("summary_large_image"))
    .on("head", { element(e) {
      e.append(`<link rel="canonical" href="${origin}/"><meta property="og:url" content="${origin}/"><meta property="og:image" content="${origin}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`, { html: true });
    } })
    .transform(new Response(res.body, { status: res.status, headers: (() => { const h = new Headers(res.headers); h.set("cache-control", "no-cache"); return h; })() }));
}
