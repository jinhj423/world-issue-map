// 월드펄스 첫 화면(A2안 한 화면 대시보드, 2026-11-19). 자료: /data/pulse.json(나라별 지수·사건 묶음), /data/brief.json(AI 세계 브리핑·나라별 요약),
// /data/news.json(위키백과 주요 사건, CC BY-SA 4.0), /data/calendar.json(투자자판 경제 일정).
// 숫자 출처: GDELT 15분 파일(GKG·사건)을 월드펄스 수집기(pulse/collect)가 센 값. 시세·기사 제목은 쓰지 않는다.
(() => {
  "use strict";
  const ED = location.pathname.startsWith("/invest") ? "invest" : "general";
  document.body.dataset.ed = ED;
  const CFG = {
    general: { key: "g", n: "n", r: "r", b: "b", s: "s", h: "h", rank: "general", cats: "general_cats", all: "전체", metric: "보도 지수",
      h1: "세계가 많이 다룬 이슈", mapT: "세계 보도 지수", rankT: "지금 많이 다루는 나라", topT: "가장 많이 다룬 나라",
      lead: "최근 24시간 기사 수와 평소 대비 변화로 매긴 0~100 점수입니다.", art: "기사" },
    invest: { key: "gi", n: "i", r: "ir", b: "ib", s: "si", h: "hi", rank: "invest", cats: "invest_cats", all: "시장 전체", metric: "시장 보도 지수",
      h1: "투자자가 볼 세계 이슈", mapT: "시장 보도 지수", rankT: "시장 보도가 몰린 나라", topT: "시장 기사가 가장 많은 나라",
      lead: "경제·시장·에너지·무역 기사만 세어 매긴 0~100 점수입니다. 투자 권유가 아닙니다.", art: "시장 기사" },
  }[ED];
  const STEPS = 7;
  const SHOW = 10;
  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  let P = null, N = null, B = null, paths = null, expanded = false, newsDay = null, newsAll = false;
  let sel = (params.get("c") || "").toUpperCase() || null;
  let cat = params.get("cat") || "all";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "없음" : Number(n).toLocaleString("ko-KR"));
  const sign = (x) => (x > 0 ? "+" : "") + x.toFixed(1);
  const clock = (iso) => (iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 ${iso.slice(11, 16)}` : "알 수 없음");
  const DOW = "일월화수목금토";
  const dow = (d) => DOW[new Date(`${d}T12:00:00+09:00`).getUTCDay()];
  const name = (iso) => (P.meta[iso] || {}).ko || iso;
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : "#");
  const flag = (iso) => `<img class="flag" src="/flags/${iso.toLowerCase()}.svg" alt="" width="24" height="18" loading="lazy">`;
  // 화면에 보이는 소수 한 자리 값으로 판단한다(1.06은 "1.1배"로 보이므로 오른 쪽으로 친다)
  const upDown = (r) => (r == null ? "" : Math.round(r * 10) >= 11 ? "up" : Math.round(r * 10) <= 9 ? "down" : "");
  const cname = (iso) => `<span class="nm">${flag(iso)}<a href="/c/${iso.toLowerCase()}/">${esc(name(iso))}</a></span>`;
  const evName = (g) => (P.evk || {})[g] || g;
  const evRatio = (r, b) => (r == null ? "" : b != null && b < 1 ? "평소엔 거의 없음" : `평소의 ${r.toFixed(1)}배`);
  // '왜 늘었나' 한 줄: 기사 10건 넘고 평소의 1.5배를 넘은 사건 묶음 중 기사 수 × 배수(5배까지)가 가장 큰 것
  function why(iso) {
    let best = null;
    const sc = (e) => e[1] * Math.min(5, e[2]);
    for (const e of (P.countries[iso] || {}).e || []) if (e[1] >= 10 && e[2] != null && e[2] >= 1.5 && (!best || sc(e) > sc(best))) best = e;
    return best ? `${evName(best[0])} 늘어남` : "";
  }
  const dd = (d) => `${+d.slice(5, 7)}.${d.slice(8, 10)}`;

  async function getJSON(u) {
    const r = await fetch(u, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${u} ${r.status}`);
    return r.json();
  }

  // 선 그래프(경로). area면 0부터, 아니면 최솟값~최댓값으로 모양만 보여 준다.
  function line(vals, w, h, { area = false, pad = 3, cls = "spk" } = {}) {
    const n = vals.length;
    if (n < 2) return "";
    const max = Math.max(1, ...vals), min = area ? 0 : Math.min(...vals);
    const ys = vals.map((v) => h - pad - ((v - min) / Math.max(1, max - min)) * (h - pad * 2));
    const d = ys.map((y, i) => `${i ? "L" : "M"}${((i / (n - 1)) * w).toFixed(1)},${y.toFixed(1)}`).join("");
    return { ys, svg: `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${area ? `<path class="${cls}-ar" d="${d}L${w},${h}L0,${h}Z"/>` : ""}<path class="${cls}" d="${d}"/></svg>` };
  }

  function setURL() {
    const q = new URLSearchParams();
    if (sel) q.set("c", sel);
    if (cat !== "all") q.set("cat", cat);
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
  }

  // 지금 고른 분야의 값과 순서
  function value(iso) {
    const c = P.countries[iso];
    if (!c) return null;
    return cat === "all" ? c[CFG.key] : (c.c || {})[cat] || 0;
  }
  function order() {
    if (cat === "all") return P.rank[CFG.rank] || [];
    return Object.keys(P.countries).filter((i) => ((P.countries[i].c || {})[cat] || 0) >= 5)
      .sort((a, b) => P.countries[b].c[cat] - P.countries[a].c[cat]).slice(0, 80);
  }
  function surgeList() {
    if (ED === "general") return P.rank.surge || [];
    return Object.keys(P.countries).filter((i) => P.countries[i].ir != null && P.countries[i].ir >= 1.6 && P.countries[i].i >= 50)
      .sort((a, b) => P.countries[b].ir - P.countries[a].ir).slice(0, 15);
  }
  // 지도 색: 값이 있는 나라들 사이의 순위(분위)로 7단계 — 큰 나라 몇 곳에 색이 몰리지 않게
  let LV = {};
  function computeLevels() {
    LV = {};
    const min = cat === "all" ? (ED === "invest" ? 10 : 20) : 5;
    const xs = Object.keys(P.countries).filter((i) => (cat === "all" ? P.countries[i][CFG.n] : (P.countries[i].c || {})[cat] || 0) >= min)
      .sort((a, b) => value(a) - value(b));
    xs.forEach((iso, k) => { LV[iso] = Math.min(STEPS - 1, Math.floor((STEPS * k) / Math.max(1, xs.length))); });
  }

  // 분야 단추
  function renderChips() {
    const keys = ["all", ...P[CFG.cats]];
    $("#chips").innerHTML = keys.map((k) => `<button type="button" class="chip" data-cat="${k}" aria-pressed="${k === cat}">${esc(k === "all" ? CFG.all : P.cats[k])}</button>`).join("");
  }

  function renderLegend() {
    const what = cat === "all" ? CFG.metric : `${P.cats[cat]} 기사 수`;
    const base = P.baseline_days >= 7 ? "색은 나라끼리 순위입니다" : `평소 수준은 ${P.baseline_days}일치로 계산 중입니다`;
    $("#legend").innerHTML = `<span class="lg">${esc(what)}</span><span class="lg">낮음<span class="ramp" aria-hidden="true">${Array.from({ length: STEPS }, (_, i) => `<i class="m${i}"></i>`).join("")}</span>높음</span><span class="lg"><i class="ndsw" aria-hidden="true"></i>기사 적음</span><span class="base">${esc(base)}</span>`;
  }

  // 지도
  async function drawMap() {
    const box = $("#map");
    try {
      const topo = await getJSON("/vendor/countries-110m.json");
      const feats = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.properties.name !== "Antarctica");
      const byId = {};
      for (const [iso, m] of Object.entries(P.meta)) if (m.id) byId[m.id] = iso;
      for (const f of feats) f.iso = byId[f.id] || (f.properties.name === "Kosovo" ? "XK" : null);
      const W = 1000, H = 500;
      const proj = d3.geoEqualEarth().fitExtent([[6, 6], [W - 6, H - 6]], { type: "FeatureCollection", features: feats });
      const path = d3.geoPath(proj);
      box.innerHTML = "";
      const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
        .attr("aria-label", "나라별 지수 지도. 나라를 누르면 그 나라 페이지로 갑니다. 오른쪽 순위에서 같은 내용을 볼 수 있습니다.");
      const g = svg.append("g");
      CEN = {};
      for (const f of feats) if (f.iso) { const [x, y] = path.centroid(f); if (isFinite(x)) CEN[f.iso] = [+(x / 10).toFixed(2), +(y / 5).toFixed(2)]; }
      paths = g.selectAll("path").data(feats).join("path").attr("d", path).attr("class", "cty nd").attr("data-iso", (f) => f.iso)
        .on("click", (e, f) => { if (f.iso && P.countries[f.iso]) go(f.iso, e); })
        .on("mousemove", (e, f) => tip(e, f.iso, f.properties.name))
        .on("mouseleave", () => { $("#tip").hidden = true; });
      const z = d3.zoom().scaleExtent([1, 8]).translateExtent([[0, 0], [W, H]])
        .filter((e) => (e.type.startsWith("touch") ? e.touches && e.touches.length > 1 : e.type === "wheel" ? e.ctrlKey || e.metaKey : !e.button))
        .on("zoom", (e) => { g.attr("transform", e.transform); box.classList.toggle("zoomed", e.transform.k > 1.01); });
      svg.call(z).on("dblclick.zoom", null);
      paintMap();
      renderPins();
    } catch (err) {
      box.innerHTML = `<p class="state err">지도를 그리지 못했습니다. 순위는 그대로 쓸 수 있습니다.</p>`;
    }
  }
  function paintMap() {
    if (!paths) return;
    paths.attr("class", (f) => `cty ${f.iso && f.iso in LV ? `m${LV[f.iso]}` : "nd"}${f.iso && f.iso === sel ? " sel" : ""}`);
    paths.filter((f) => f.iso === sel).raise();
  }
  function tip(e, iso, en) {
    const t = $("#tip");
    const c = iso && P.countries[iso];
    const w = c && why(iso);
    t.textContent = c ? `${name(iso)}  ${cat === "all" ? CFG.metric : P.cats[cat]} ${fmt(value(iso))}${w ? `, ${w}` : ""}` : `${iso ? name(iso) : en}  기사 적음`;
    t.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
    t.style.transform = `translate(${x}px, ${e.clientY + 16}px)`;
  }

  // 순위
  function renderRank() {
    const ord = order();
    const ol = $("#rank");
    ol.classList.toggle("cat", cat !== "all");
    $("#h-rank").textContent = cat === "all" ? CFG.rankT : `${P.cats[cat]} 기사가 많은 나라`;
    $("#rank-hint").textContent = cat === "all" ? "지수, 평소 대비" : "기사, 그 나라 기사 중 비중";
    const more = $("#more");
    if (!ord.length) {
      ol.innerHTML = `<li class="state">${cat === "all" ? "첫 자료를 모으는 중입니다. GDELT 파일은 15분마다 나옵니다." : "이 분야 기사가 아직 적습니다."}</li>`;
      more.hidden = true;
      return;
    }
    more.hidden = ord.length <= SHOW;
    more.textContent = expanded ? "순위 접기" : `순위 더 보기 (${ord.length}곳)`;
    more.setAttribute("aria-expanded", expanded);
    const selAt = ord.indexOf(sel);
    const row = (iso, k) => {
      const c = P.countries[iso];
      const v = cat === "all" ? c[CFG.key] : fmt(c.c[cat]);
      const rt = cat === "all" ? `<span class="rt ${upDown(c[CFG.r])}">${rtxt(c[CFG.r])}</span>` : `<span class="rt">${Math.round((100 * c.c[cat]) / Math.max(1, c.n))}%</span>`;
      return `<li data-iso="${iso}" aria-selected="${iso === sel}"><span class="rn">${k + 1}</span>${cname(iso)}<span class="ix">${v}</span>${rt}</li>`;
    };
    // 접힌 상태에서 고른 나라가 12위 밖이면 그 줄만 아래에 덧붙인다
    ol.innerHTML = (expanded ? ord : ord.slice(0, SHOW)).map(row).join("")
      + (!expanded && selAt >= SHOW ? `<li class="gap" aria-hidden="true"></li>${row(sel, selAt)}` : "");
  }

  // 나라 페이지로 간다(Ctrl·⌘이면 새 탭)
  function go(iso, e) {
    const url = `/c/${iso.toLowerCase()}/`;
    if (e && (e.metaKey || e.ctrlKey)) window.open(url, "_blank", "noopener"); else location.href = url;
  }
  function bindGo(el) {
    el.addEventListener("click", (e) => {
      const li = e.target.closest("[data-iso]");
      if (!li || !el.contains(li) || e.target.closest("a")) return;
      go(li.dataset.iso, e);
    });
  }
  // 평소 대비: 늘면 ▲ 빨강, 줄면 ▼ 파랑(색을 못 봐도 화살표로 구분)
  const arrow = (r) => ({ up: "▲ ", down: "▼ " }[upDown(r)] || "");
  const rtxt = (r) => (r == null ? "계산 중" : `${arrow(r)}${r.toFixed(1)}배`);
  // 이 나라에서 가장 크게 늘어난 사건 묶음(기사 10건 넘고 평소의 1.5배 이상, 기사 수 × 배수가 가장 큰 것)
  function evTop(iso) {
    let best = null;
    const sc = (e) => e[1] * Math.min(5, e[2]);
    for (const e of (P.countries[iso] || {}).e || []) if (e[1] >= 10 && e[2] != null && e[2] >= 1.5 && (!best || sc(e) > sc(best))) best = e;
    return best;
  }

  // 요약 띠 네 칸 — worker.js kpiStrip과 같은 모양
  function renderKpis() {
    const top = (P.rank[CFG.rank] || [])[0], sg = surgeList()[0];
    const cats = P[CFG.cats].map((k) => [k, P.global.c[k] || 0]).sort((a, b) => b[1] - a[1]);
    const who = (iso, tail) => `<a class="kv" href="/c/${iso.toLowerCase()}/">${flag(iso)}${esc(name(iso))}${tail}</a>`;
    const cell = (l, v) => `<div class="kc"><span class="kl">${esc(l)}</span>${v}</div>`;
    $("#kpis").innerHTML = [
      cell("24시간 전 세계 기사", `<span class="kv">${fmt(P.global.n)}</span>`),
      cell(CFG.topT, top ? who(top, ` <small>${fmt(P.countries[top][CFG.n])}건</small>`) : `<span class="kv">없음</span>`),
      cell("평소보다 가장 크게 늘어난 곳", sg ? who(sg, ` <b class="up">${rtxt(P.countries[sg][CFG.r])}</b>`) : `<span class="kv"><small>${P.baseline_days < 3 ? "평소 수준 계산 중" : "1.6배 넘은 곳 없음"}</small></span>`),
      cell("가장 많이 다룬 분야", cats[0] ? `<span class="kv">${esc(P.cats[cats[0][0]])} <small>기사의 ${Math.round((100 * cats[0][1]) / Math.max(1, P.global.n))}%</small></span>` : `<span class="kv">없음</span>`),
    ].join("");
  }
  // AI 브리핑: 첫 줄은 크게, 그 나라 기사 수·평소 대비·가장 늘어난 사건을 붙이고, 나머지는 국기와 한 줄씩.
  // 숫자는 늘 일반판 기준(그 나라 전체 기사)이다. worker.js briefBody와 같은 모양.
  function renderBrief() {
    const box = $("#brief-body");
    const xs = (B && B.world && B.world.items) || [];
    $("#brief-at").textContent = B && B.at ? `AI 정리 ${B.at.slice(11, 16)}` : "";
    if (!xs.length) {
      if (!box.querySelector(".bl-t")) box.innerHTML = `<p class="state">${B ? "AI 브리핑을 준비하는 중입니다. 2시간마다 새로 씁니다." : "AI 브리핑을 받는 중"}</p>`;
      return;
    }
    const [it, ...rest] = xs;
    const iso = (it.c || []).find((x) => P.countries[x]);
    const c = iso && P.countries[iso], ev = iso && evTop(iso);
    const chips = c ? `<div class="bl-c"><a class="bl-chip" href="/c/${iso.toLowerCase()}/">${flag(iso)}${esc(name(iso))} ${fmt(c.n)}건</a><span class="bl-chip ${upDown(c.r)}">평소 ${rtxt(c.r)}</span>${ev ? `<span class="bl-chip up">${esc(evName(ev[0]))} ${ev[3] != null && ev[3] < 1 ? "평소엔 거의 없음" : rtxt(ev[2])}</span>` : ""}</div>` : "";
    const fl = (x) => (x.c || []).slice(0, 2).map((i) => flag(i)).join("");
    box.innerHTML = `${it.k ? `<span class="bl-k">${esc(it.k)}</span>` : ""}<p class="bl-t">${esc(it.t)}</p>${chips}<ul class="bl-l">${rest.map((x) => {
      const j = (x.c || []).find((y) => P.countries[y]);
      return `<li><span class="bl-f">${fl(x)}</span><span>${x.k ? `<span class="bl-k">${esc(x.k)}</span>` : ""}${j ? `<a href="/c/${j.toLowerCase()}/">${esc(x.t)}</a>` : esc(x.t)}</span></li>`;
    }).join("")}</ul>`;
  }
  // 한국은 지금: 순위·평소 대비 한 줄과 한국 AI 요약
  function renderKorea() {
    const box = $("#korea"), c = P.countries.KR;
    if (!c) { box.hidden = true; return; }
    const rk = (P.rank[CFG.rank] || []).indexOf("KR");
    const ai = B && (B.countries || {}).KR;
    box.hidden = false;
    box.innerHTML = `<div class="kb-h">${flag("KR")}<h2 id="h-kr">한국은 지금</h2><span class="kb-n">${rk >= 0 ? `${rk + 1}위` : "순위 밖"} <b class="${upDown(c[CFG.r])}">${rtxt(c[CFG.r])}</b></span></div><p class="kb-t">${ai && ai.s ? esc(ai.s) : "AI 요약을 준비하는 중입니다."}</p><a class="kb-go" href="/c/kr/">한국 페이지</a>`;
  }
  // 평소보다 크게 늘어난 곳: 배수 막대 + 늘어난 사건과 기사 수 한 줄
  function renderSurge() {
    const xs = surgeList().slice(0, 6), ol = $("#surge");
    if (!xs.length) {
      ol.innerHTML = `<li class="state">${P.baseline_days < 3 ? `평소 수준을 계산할 자료가 ${P.baseline_days}일치뿐이라 아직 고르지 않습니다.` : `${ED === "invest" ? "시장 기사 50건" : "기사 100건"} 넘는 나라 중 평소의 1.6배를 넘은 곳이 없습니다.`}</li>`;
      return;
    }
    const max = Math.max(...xs.map((i) => P.countries[i][CFG.r] || 0));
    ol.innerHTML = xs.map((iso) => {
      const c = P.countries[iso], w = why(iso);
      return `<li data-iso="${iso}"><a class="sg-r" href="/c/${iso.toLowerCase()}/">${flag(iso)}<span class="sg-n">${esc(name(iso))}</span><span class="sg-b" aria-hidden="true"><i style="width:${((100 * c[CFG.r]) / max).toFixed(1)}%"></i></span><b class="up">${rtxt(c[CFG.r])}</b></a><p class="sg-w">${w ? `${esc(w)}, ` : ""}${esc(CFG.art)} ${fmt(c[CFG.n])}건</p></li>`;
    }).join("");
  }
  // 지도 위 표시: 평소보다 가장 크게 늘어난 나라 세 곳(전체 보기에서만, 확대하면 숨김)
  let CEN = {};
  function renderPins() {
    const box = $("#map");
    for (const x of box.querySelectorAll(".pin")) x.remove();
    if (cat !== "all") return;
    // 이름표가 겹치면 뒤의 것을 점 아래로 내린다(이름표 폭은 글자 수로 어림)
    const W = box.clientWidth || 1000, H = box.clientHeight || 500, placed = [];
    box.insertAdjacentHTML("beforeend", surgeList().filter((iso) => CEN[iso]).slice(0, 3).map((iso) => {
      const [x, y] = CEN[iso];
      const label = `${name(iso)} ${rtxt(P.countries[iso][CFG.r])}`;
      const hw = ((label.length * 8 + 16) / W) * 50, hh = (34 / H) * 100;
      const hit = (dn) => placed.some((q) => Math.abs(q.x - x) < q.hw + hw && (dn ? q.dn && Math.abs(q.y - y) < hh : !q.dn && Math.abs(q.y - y) < hh));
      const dn = hit(false) && !hit(true);
      placed.push({ x, y, hw, dn });
      return `<a class="pin${dn ? " dn" : ""}" href="/c/${iso.toLowerCase()}/" style="left:${x}%;top:${y}%"><span>${esc(name(iso))} <b>${rtxt(P.countries[iso][CFG.r])}</b></span><i aria-hidden="true"></i></a>`;
    }).join(""));
  }
  // 위키백과 문장: 한국어 번역(ko·kp)이 있으면 그것을, '원문' 단추로 영어를 펼친다
  const wtext = (it) => `${esc(it.ko || it.text)}${it.ko ? ` <button type="button" class="orig" aria-expanded="false">원문</button><span class="en" hidden>${esc(it.text)}</span>` : ""}`;
  // 배경: 그 사건 위키백과 문서의 첫 문단(번역이 있으면 한국어), 펼쳐 보기
  const bgHTML = (it) => (it.bg ? `<details class="wbg"><summary>배경 보기</summary><p>${esc(it.bgk || it.bg)}</p>${it.wu ? `<a href="${esc(safeUrl(it.wu))}" rel="noopener" target="_blank">위키백과 문서: ${esc(it.wt)}</a>` : ""}</details>` : "");
  const srcLinks = (src) => (src || []).map(([l, u]) => ` <a class="srcl" href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">${esc(l)}</a>`).join("");

  // 크게 바뀐 나라
  function miniRows(list, cols, empty) {
    if (!list.length) return `<li class="state">${esc(empty)}</li>`;
    return `<li class="h" aria-hidden="true"><span>나라</span><span class="n">${cols[0]}</span><span class="x">${cols[1]}</span></li>` + list.slice(0, 10).map((iso) => {
      const [n, x, cls] = cols[2](P.countries[iso]);
      return `<li data-iso="${iso}"><span class="nmw">${cname(iso)}</span><span class="n">${n}</span><span class="x ${cls}">${x}</span></li>`;
    }).join("");
  }
  function renderMoves() {
    renderSurge();
    $("#risk").innerHTML = miniRows(P.rank.risk || [], ["시장 기사", "논조 변화", (c) => [fmt(c.i), sign(c.dt), "down"]],
      P.baseline_days < 3 ? "평소 논조를 계산할 자료가 아직 모자랍니다." : "평소보다 논조가 나빠진 나라가 없습니다.");
  }

  // 투자 위험 신호(투자자판): rank.alert 순서, 나라마다 늘어난 위험 사건 묶음 3개까지 + AI 요약 한 줄
  function renderAlert() {
    if (ED !== "invest") return;
    const ol = $("#alerts");
    const xs = P.rank.alert || [];
    if (!P.rank.alert) { ol.innerHTML = `<li class="state">위험 신호를 계산하는 중입니다. 다음 자료 갱신(15분 안)부터 보입니다.</li>`; return; }
    if (!xs.length) {
      ol.innerHTML = `<li class="state">${P.ev_days >= 3 ? "평소보다 크게 늘어난 위험 사건 보도가 없습니다." : "평소 수준을 계산할 사건 자료가 아직 모자랍니다."}</li>`;
      return;
    }
    ol.innerHTML = xs.slice(0, 12).map((iso) => {
      const c = P.countries[iso], ai = B && (B.countries || {})[iso];
      const chips = (c.ra || []).map(([g, n, r, b]) => `<span class="evc"><b>${esc(evName(g))}</b> ${fmt(n)}건 <i class="up">${evRatio(r, b)}</i></span>`).join("");
      return `<li data-iso="${iso}"><div class="al-h">${cname(iso)}<span class="al-n">시장 기사 ${fmt(c.i)}건</span></div><div class="evs">${chips}</div>${ai ? `<p class="al-ai"><span class="ait">AI 요약</span>${esc(ai.s)}</p>` : ""}</li>`;
    }).join("");
  }

  // 분야별 48시간
  function renderMultiples() {
    const gl = P.global;
    $("#multiples").innerHTML = P[CFG.cats].map((k) => {
      const L = line(gl.hs[k] || [], 240, 40, { area: true, cls: "mln" });
      return `<div class="mult"><div class="t"><span>${esc(P.cats[k])}</span><b>${fmt(gl.c[k])}</b></div>${L ? L.svg : ""}</div>`;
    }).join("");
  }

  // 나라별 AI 요약(기사 제목 표본을 Claude가 읽고 새로 쓴 문장, 2시간마다)
  async function loadBrief() {
    try {
      B = await getJSON("/data/brief.json");
    } catch (err) {
      B = null;
      return;
    }
    renderAlert();
    renderBrief();
    renderKorea();
  }
  // 세계에서 있었던 일(위키백과 Portal:Current events, CC BY-SA 4.0)
  async function loadNews() {
    try {
      N = await getJSON("/data/news.json");
    } catch (err) {
      N = null;
      $("#news-list").innerHTML = `<p class="hint err">주요 사건을 받지 못했습니다. 잠시 뒤 새로 고쳐 주세요.</p>`;
      return;
    }
    const days = N.days || [];
    if (!newsDay || !days.some((d) => d.date === newsDay)) newsDay = (days.find((d) => d.items.length >= 4) || days.reduce((a, d) => (d.items.length > (a ? a.items.length : -1) ? d : a), null) || {}).date;
    renderNews();
  }
  // 처음 보이는 사건: 분야를 돌아가며 하나씩 골라 한 분야·한 주제·한 나라에 몰리지 않게 한다
  // (같은 주제는 하나만, 한 나라는 두 개까지). 고른 뒤에는 원래 순서대로 분야별로 보여 준다.
  function pickNews(items, lim) {
    const byCat = [];
    for (const it of items) {
      let g = byCat.find((x) => x[0] === it.cat);
      if (!g) byCat.push((g = [it.cat, []]));
      g[1].push(it);
    }
    const picked = new Set(), topics = new Set(), per = {};
    const ok = (it) => !topics.has(it.topic || it.text) && (it.c || []).every((c) => (per[c] || 0) < 2);
    for (let more = true; more && picked.size < lim;) {
      more = false;
      for (const [, xs] of byCat) {
        if (picked.size >= lim) break;
        const it = xs.find((x) => !picked.has(x) && ok(x));
        if (!it) continue;
        picked.add(it);
        topics.add(it.topic || it.text);
        for (const c of it.c || []) per[c] = (per[c] || 0) + 1;
        more = true;
      }
    }
    return items.filter((it) => picked.has(it));
  }
  function renderNews() {
    const days = (N && N.days) || [];
    const day = days.find((d) => d.date === newsDay);
    $("#news-days").innerHTML = days.map((d) => `<button type="button" data-day="${d.date}" aria-pressed="${d.date === newsDay}">${dd(d.date)}</button>`).join("");
    const box = $("#news-list"), more = $("#news-more");
    if (!day || !day.items.length) {
      box.innerHTML = `<p class="hint">이날 정리된 사건이 아직 없습니다. 위키백과 편집자들이 하루 동안 채워 갑니다.</p>`;
      more.hidden = true;
    } else {
      const LIM = 8;
      const shown = newsAll ? day.items : pickNews(day.items, LIM);
      const groups = [];
      for (const it of shown) {
        let g = groups.find((x) => x[0] === it.cat);
        if (!g) groups.push((g = [it.cat, []]));
        g[1].push(it);
      }
      box.innerHTML = groups.map(([c, xs]) => `<div class="ncat"><h3 class="subh">${esc(c)}</h3><ul class="nl">${xs.map((it) => `<li>${(it.c || []).length ? `<span class="nfs">${it.c.slice(0, 3).map((iso) => `<button type="button" class="nf" data-iso="${iso}" title="${esc(name(iso))} 보기" aria-label="${esc(name(iso))} 보기">${flag(iso)}</button>`).join("")}</span>` : ""}<span class="nt">${it.topic ? `<span class="topic">${esc(it.kp || it.topic)}</span>` : ""}${wtext(it)}${srcLinks(it.src)}${bgHTML(it)}</span></li>`).join("")}</ul></div>`).join("");
      more.hidden = day.items.length <= shown.length && !newsAll;
      more.textContent = newsAll ? "접기" : `모두 보기 (${day.items.length}건)`;
      more.setAttribute("aria-expanded", newsAll);
    }
    $("#news-src").innerHTML = day ? `출처 <a href="${esc(safeUrl(day.url))}">위키백과 Portal:Current events</a>(${dd(day.date)}, 세계 표준시 날짜, 위키백과 편집자들), <a href="${esc(safeUrl((N.source || {}).license_url || "https://creativecommons.org/licenses/by-sa/4.0/"))}">CC BY-SA 4.0</a>. ${day.items.some((it) => it.ko) ? "링크와 서식을 빼고 Claude(AI)로 한국어로 옮겼습니다. 기계 번역이라 어색할 수 있어 '원문' 단추로 영어를 볼 수 있습니다." : "링크와 서식을 빼고 영어 원문 그대로 옮겼습니다."} '배경 보기'는 그 사건을 다룬 위키백과 문서의 첫 문단입니다. 이 칸의 문장은 같은 라이선스를 따릅니다. 국기를 누르면 그 나라를 봅니다.` : "";
  }

  // 경제 일정(투자자판)
  async function renderCal() {
    if (ED !== "invest") return;
    const ol = $("#cal-list");
    try {
      const cal = await getJSON("/data/calendar.json");
      const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const end = new Date(Date.now() + (9 + 24 * 21) * 3600e3).toISOString().slice(0, 10);
      const items = (cal.items || []).filter((x) => x.date >= today && x.date <= end).slice(0, 12);
      ol.innerHTML = items.length ? items.map((x) => `<li><span class="d">${x.date.slice(5).replace("-", ".")}(${dow(x.date)})</span><span class="tm">${esc(x.time === "—" ? "미정" : x.time)}</span><span>${esc(x.title)}</span>${x.imp >= 3 ? `<span class="imp">중요</span>` : "<span></span>"}</li>`).join("")
        : `<li class="state">앞으로 3주 안에 잡힌 공개 일정이 없습니다.</li>`;
    } catch (err) {
      ol.innerHTML = `<li class="state err">경제 일정을 받지 못했습니다. 잠시 뒤 새로 고쳐 주세요.</li>`;
    }
  }

  // 나라 찾기 — 공식 이름·옛 이름·흔한 줄임말도 찾는다
  const ALIAS = {
    KR: ["대한민국", "남한", "코리아", "korea", "south korea", "republic of korea", "rok"], KP: ["북조선", "조선민주주의인민공화국", "north korea", "dprk"],
    US: ["미합중국", "아메리카", "usa", "america", "united states of america"], GB: ["잉글랜드", "브리튼", "대영제국", "uk", "britain", "england"],
    TR: ["터키", "튀르키예", "turkey", "turkiye"], CN: ["중화인민공화국", "중공", "prc"], TW: ["중화민국", "roc"], JP: ["일본국", "nippon"],
    RU: ["러시아연방", "russian federation"], ZA: ["남아공", "남아프리카"], CD: ["민주콩고", "콩고민주공화국", "drc", "dr congo"], CG: ["콩고공화국"],
    AE: ["uae", "에미리트"], SA: ["사우디", "ksa"], MM: ["버마", "burma"], CI: ["아이보리코스트", "ivory coast"], SZ: ["스와질란드", "swaziland"],
    CZ: ["체코공화국", "czechia"], MK: ["마케도니아", "macedonia"], TL: ["티모르레스테", "동티모르"], NL: ["홀란드", "holland"], VA: ["교황청", "바티칸시국"],
    GE: ["그루지야"], BY: ["벨로루시", "belorussia"], IR: ["페르시아", "persia"], VN: ["베트남사회주의공화국"], LA: ["라오"], KH: ["캄보디아왕국"],
    PS: ["팔레스타인", "가자", "gaza", "웨스트뱅크"], IL: ["이스라엘국"], DE: ["독일연방공화국"], FR: ["프랑스공화국"], NZ: ["뉴질랜드"],
  };
  function initSearch() {
    const q = $("#q"), ul = $("#sugg");
    let items = [], at = -1;
    const close = () => { ul.hidden = true; q.setAttribute("aria-expanded", "false"); q.removeAttribute("aria-activedescendant"); };
    const mark = () => {
      for (const [k, li] of [...ul.querySelectorAll("li[data-iso]")].entries()) li.setAttribute("aria-selected", k === at);
      if (at >= 0 && items[at]) q.setAttribute("aria-activedescendant", `sg-${items[at].iso}`);
    };
    const pick = (iso) => {
      close(); q.value = ""; q.blur();
      go(iso);
    };
    const nz = (s) => s.toLowerCase().replace(/[\s.·'-]/g, "");
    function show() {
      const t = nz(q.value.trim());
      if (!t) { close(); return; }
      const cnt = (iso) => (P.countries[iso] || {})[CFG.n] || 0;
      items = Object.entries(P.meta).map(([iso, m]) => {
        const names = [m.ko || iso, m.en || "", ...(ALIAS[iso] || [])].map(nz);
        const hit = iso.toLowerCase() === t ? 3 : names.some((x) => x === t) ? 3 : names.some((x) => x.startsWith(t)) ? 2 : names.some((x) => x.includes(t)) ? 1 : 0;
        return { iso, ko: m.ko || iso, en: m.en || "", hit };
      }).filter((x) => x.hit).sort((a, b) => (b.hit - a.hit) || cnt(b.iso) - cnt(a.iso)).slice(0, 8);
      at = items.length ? 0 : -1;
      ul.innerHTML = items.length
        ? items.map((x) => `<li role="option" id="sg-${x.iso}" data-iso="${x.iso}">${flag(x.iso)}<span>${esc(x.ko)}</span><span class="en">${P.countries[x.iso] ? esc(x.en) : "기사 적음"}</span></li>`).join("")
        : `<li class="none" role="option" aria-disabled="true">맞는 나라가 없습니다. 한글이나 영어 이름으로 찾아 보세요.</li>`;
      ul.hidden = false;
      q.setAttribute("aria-expanded", "true");
      mark();
    }
    q.addEventListener("input", show);
    q.addEventListener("focus", () => { if (q.value.trim()) show(); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (ul.hidden) show();
        if (!items.length) return;
        e.preventDefault();
        at = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        mark();
      } else if (e.key === "Enter") {
        if (at >= 0 && items[at]) { e.preventDefault(); pick(items[at].iso); }
      } else if (e.key === "Escape") {
        if (!ul.hidden) close(); else { q.value = ""; q.blur(); }
      }
    });
    ul.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-iso]");
      e.preventDefault();
      if (li) pick(li.dataset.iso);
    });
    q.addEventListener("blur", () => setTimeout(close, 120));
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
    });
  }

  function renderHead() {
    if (!P) return;
    for (const a of document.querySelectorAll(".tabs a")) if (a.dataset.ed === ED) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    document.title = ED === "invest" ? "투자자가 볼 세계 이슈 | 월드펄스 투자자판" : "세계가 많이 다룬 이슈 | 월드펄스";
    $("#h-board").textContent = `${+P.asof.slice(5, 7)}월 ${+P.asof.slice(8, 10)}일, ${CFG.h1}`;
    $("#h-map").textContent = CFG.mapT;
    $("#lead").textContent = CFG.lead;
    const as = $("#asof");
    const late = Date.now() - Date.parse(P.asof) > 3 * 3600e3;
    as.textContent = `${clock(P.asof)} 기준`;
    as.classList.toggle("stale", late);
    as.classList.remove("bad");
    if (late) as.title = "GDELT 파일이 평소보다 늦게 올라오고 있습니다"; else as.removeAttribute("title");
  }

  function renderAll(first) {
    if (cat !== "all" && !P[CFG.cats].includes(cat)) cat = "all";
    renderHead();
    computeLevels();
    renderChips();
    renderLegend();
    renderRank();
    paintMap();
    renderPins();
    if (first) { renderKpis(); renderBrief(); renderKorea(); renderMoves(); renderAlert(); renderMultiples(); renderCal(); }
  }

  function showError() {
    const as = $("#asof");
    as.textContent = "자료를 받지 못했습니다";
    as.classList.add("bad");
    $("#rank").innerHTML = `<li class="state"><p class="err">자료를 받지 못했습니다. 연결을 확인한 뒤 다시 받아 주세요.</p><button type="button" class="retry" id="retry">다시 받기</button></li>`;
    $("#retry").onclick = (e) => { e.target.disabled = true; e.target.textContent = "받는 중"; start(); };
    const ms = $("#map-state");
    if (ms) ms.textContent = "자료가 없어 지도를 칠하지 못했습니다";
    for (const id of ["#surge", "#risk"]) $(id).innerHTML = `<li class="state">자료를 받지 못했습니다.</li>`;
    $("#multiples").innerHTML = `<p class="hint">자료를 받지 못했습니다.</p>`;
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("button.orig");
    if (!b) return;
    const en = b.nextElementSibling, open = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", open);
    b.textContent = open ? "원문 닫기" : "원문";
    if (en) en.hidden = !open;
  });

  let bound = false;
  async function start() {
    try {
      P = await getJSON("/data/pulse.json");
    } catch (err) {
      showError();
      return;
    }
    if (!bound) {
      bound = true;
      // 순위 줄을 누르면 그 나라 페이지로 간다(이름 링크는 그대로, Ctrl·⌘이면 새 탭)
      $("#rank").addEventListener("click", (e) => {
        const li = e.target.closest("li[data-iso]");
        if (!li || e.target.closest("a")) return;
        const url = `/c/${li.dataset.iso.toLowerCase()}/`;
        if (e.metaKey || e.ctrlKey) window.open(url, "_blank", "noopener"); else location.href = url;
      });
      bindGo($("#surge"));
      bindGo($("#risk"));
      bindGo($("#alerts"));
      $("#chips").addEventListener("click", (e) => {
        const b = e.target.closest("[data-cat]");
        if (!b || b.dataset.cat === cat) return;
        cat = b.dataset.cat;
        expanded = false;
        setURL();
        renderAll(false);
      });
      $("#more").addEventListener("click", () => { expanded = !expanded; renderRank(); });
      $("#news-days").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b && b.dataset.day !== newsDay) { newsDay = b.dataset.day; newsAll = false; renderNews(); } });
      $("#news-more").addEventListener("click", () => { newsAll = !newsAll; renderNews(); });
      $("#news-list").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-iso]");
        if (!b) return;
        go(b.dataset.iso, e);
      });
      initSearch();
      setInterval(async () => {
        try {
          const np = await getJSON("/data/pulse.json");
          if (np.asof !== P.asof) { P = np; renderAll(true); }
        } catch (err) { /* 다음 차례에 다시 받는다 */ }
        loadNews();
        loadBrief();
      }, 5 * 60e3);
    }
    renderAll(true);
    loadNews();
    loadBrief();
    if (!paths) await drawMap();
  }
  start();
})();
