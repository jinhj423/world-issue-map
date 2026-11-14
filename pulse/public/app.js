// 월드펄스 화면. 자료: /data/pulse.json(나라별 지수), /data/detail.json(인물·장소·언론·기사 주소, 처음 고를 때 받음), /data/calendar.json(투자자판 경제 일정).
// 숫자 출처: GDELT 15분 파일을 월드펄스 수집기(pulse/collect)가 센 값. 시세·기사 제목은 쓰지 않는다.
(() => {
  "use strict";
  const ED = location.pathname.startsWith("/invest") ? "invest" : (document.body.dataset.ed || "general");
  document.body.dataset.ed = ED;
  const CFG = {
    general: { key: "g", n: "n", r: "r", b: "b", s: "s", rank: "general", cats: "general_cats", all: "전체", metric: "보도 지수",
      h1: "전 세계 언론이 지금 다루는 나라", lead: "최근 24시간 기사 수와 평소 대비 변화로 매긴 보도 지수입니다." },
    invest: { key: "gi", n: "i", r: "ir", b: "ib", s: "si", rank: "invest", cats: "invest_cats", all: "시장 관련 전체", metric: "시장 보도 지수",
      h1: "시장 관련 보도가 몰린 나라", lead: "경제·시장·에너지·무역 기사만 세어 매긴 지수입니다. 투자 권유가 아닙니다." },
  }[ED];
  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  const SHOW = 12;
  let expanded = false;
  let P = null, D = null, sel = (params.get("c") || "").toUpperCase() || null, cat = params.get("cat") || "all";
  let paths = null;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "없음" : Number(n).toLocaleString("ko-KR"));
  const ratio = (r) => (r == null ? "계산 중" : `${r.toFixed(1)}배`);
  const sign = (x) => (x > 0 ? "+" : "") + x.toFixed(1);
  const josa = (w, a, b) => { const c = (w || "").charCodeAt((w || "").length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b); };
  const clock = (iso) => (iso ? `${iso.slice(5, 7)}.${iso.slice(8, 10)} ${iso.slice(11, 16)}` : "알 수 없음");
  const name = (iso) => (P.meta[iso] || {}).ko || iso;
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : "#");

  async function getJSON(u) {
    const r = await fetch(u, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${u} ${r.status}`);
    return r.json();
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
  // 지도 색 단계: 값이 있는 나라들 사이의 순위(분위)로 8단계 — 큰 나라 몇 곳에 색이 몰리지 않게
  let LV = {};
  function computeLevels() {
    LV = {};
    const min = cat === "all" ? (ED === "invest" ? 10 : 20) : 5;
    const xs = Object.keys(P.countries).filter((i) => (cat === "all" ? P.countries[i][CFG.n] : (P.countries[i].c || {})[cat] || 0) >= min)
      .sort((a, b) => value(a) - value(b));
    xs.forEach((iso, k) => { LV[iso] = Math.min(7, Math.floor((8 * k) / Math.max(1, xs.length))); });
  }
  const level = (iso) => (iso in LV ? LV[iso] : -1);

  // 분야 단추
  function renderChips() {
    const keys = ["all", ...P[CFG.cats]];
    $("#chips").innerHTML = keys.map((k) => `<button type="button" class="chip" data-cat="${k}" aria-pressed="${k === cat}">${esc(k === "all" ? CFG.all : P.cats[k])}</button>`).join("");
    $("#chips").onclick = (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      cat = b.dataset.cat;
      setURL();
      renderAll(false);
    };
  }

  function renderLegend() {
    const what = cat === "all" ? CFG.metric : `${P.cats[cat]} 기사 수`;
    const base = P.baseline_days >= 7 ? "" : ` 평소 수준은 ${P.baseline_days}일치로 계산 중입니다.`;
    $("#legend").innerHTML = `<span>${esc(what)}</span><span>하위</span><span class="ramp" aria-hidden="true">${"<i></i>".repeat(8)}</span><span>상위</span><span class="sw-none" aria-hidden="true"></span><span>기사 적음</span><span class="muted">${esc(base)}</span>`;
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
      const W = 960, H = 470;
      const proj = d3.geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: "FeatureCollection", features: feats });
      const path = d3.geoPath(proj);
      box.innerHTML = "";
      const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
        .attr("aria-label", "나라별 지수 지도. 아래 순위표에서 같은 내용을 볼 수 있습니다.");
      const g = svg.append("g");
      paths = g.selectAll("path").data(feats).join("path").attr("d", path).attr("class", "c none")
        .on("click", (e, f) => { if (f.iso && P.countries[f.iso]) select(f.iso, true); })
        .on("mousemove", (e, f) => tip(e, f.iso, f.properties.name))
        .on("mouseleave", () => ($("#tip").hidden = true));
      const z = d3.zoom().scaleExtent([1, 8]).translateExtent([[0, 0], [W, H]])
        .filter((e) => (e.type.startsWith("touch") ? e.touches && e.touches.length > 1 : e.type === "wheel" ? e.ctrlKey || e.metaKey : !e.button))
        .on("zoom", (e) => g.attr("transform", e.transform));
      svg.call(z).on("dblclick.zoom", null);
      paintMap();
    } catch (err) {
      box.innerHTML = `<p class="state err">지도를 그리지 못했습니다. 순위표는 그대로 쓸 수 있습니다.</p>`;
    }
  }
  function paintMap() {
    if (!paths) return;
    paths.attr("class", (f) => {
      const lv = f.iso ? level(f.iso) : -1;
      return `c ${lv < 0 ? "none" : `l${lv}`}${f.iso && f.iso === sel ? " sel" : ""}`;
    });
    paths.filter((f) => f.iso === sel).raise();
  }
  function tip(e, iso, en) {
    const t = $("#tip");
    const c = iso && P.countries[iso];
    const v = c ? value(iso) : null;
    t.textContent = `${iso ? name(iso) : en} ${c ? `${cat === "all" ? CFG.metric : P.cats[cat]} ${fmt(v)}` : "기사 적음"}`;
    t.hidden = false;
    const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
    t.style.transform = `translate(${x}px, ${e.clientY + 14}px)`;
  }

  // 순위표
  function renderRank() {
    const ord = order();
    $("#th-v").textContent = cat === "all" ? "지수" : "분야 기사";
    $("#th-r").textContent = cat === "all" ? "평소 대비" : "비중";
    const body = $("#rank-body");
    if (!ord.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted">${cat === "all" ? "첫 자료를 모으는 중입니다. GDELT 파일은 15분마다 나옵니다." : "이 분야 기사가 아직 적습니다."}</td></tr>`;
      return;
    }
    const more = $("#more");
    more.hidden = ord.length <= SHOW;
    more.textContent = expanded ? "순위 접기" : `순위 더 보기 (${ord.length}곳)`;
    more.setAttribute("aria-expanded", expanded);
    more.onclick = () => { expanded = !expanded; renderRank(); };
    const selAt = ord.indexOf(sel);
    const shown = expanded ? ord : ord.slice(0, Math.max(SHOW, selAt + 1));
    body.innerHTML = shown.map((iso, k) => {
      const c = P.countries[iso];
      const v = cat === "all" ? c[CFG.key] : fmt(c.c[cat]);
      const r = cat === "all" ? ratio(c[CFG.r]) : `${Math.round((100 * c.c[cat]) / Math.max(1, c.n))}%`;
      return `<tr data-iso="${iso}" tabindex="0" aria-selected="${iso === sel}"><td class="num">${k + 1}</td><td>${esc(name(iso))}</td><td class="num">${v}</td><td class="num">${fmt(c[CFG.n])}</td><td class="num">${r}</td></tr>`;
    }).join("");
  }
  function bindRank() {
    const body = $("#rank-body");
    body.onclick = (e) => {
      const tr = e.target.closest("tr[data-iso]");
      if (tr) { e.preventDefault(); select(tr.dataset.iso, true); }
    };
    body.onkeydown = (e) => {
      const tr = e.target.closest("tr[data-iso]");
      if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(tr.dataset.iso, true); }
    };
  }

  function select(iso, scroll) {
    sel = iso;
    setURL();
    for (const tr of document.querySelectorAll("#rank-body tr[data-iso]")) tr.setAttribute("aria-selected", tr.dataset.iso === sel);
    paintMap();
    renderDetail();
    if (scroll && innerWidth < 960) $("#detail").scrollIntoView({ block: "start" });
  }

  // 나라 자세히
  function bars7(vals) {
    const w = 336, h = 120, max = Math.max(1, ...vals), bw = 24, gap = (w - bw * 7) / 6;
    return `<svg class="bars7" viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 7일 날짜별 기사 수: ${vals.map((v, i) => `${P.days[i].slice(5)} ${v}건`).join(", ")}. 마지막 날은 기준 시각까지입니다.">${vals.map((v, i) => {
      const bh = Math.round((v / max) * (h - 28)), x = Math.round(i * (bw + gap));
      return `<rect class="${i === vals.length - 1 ? "b-now" : "b"}" x="${x}" y="${h - 20 - bh}" width="${bw}" height="${bh}"></rect><text class="ax" x="${x + bw / 2}" y="${h - 4}" text-anchor="middle">${P.days[i].slice(8)}</text>`;
    }).join("")}</svg>`;
  }
  function renderDetail() {
    const box = $("#detail");
    if (!sel || !P.countries[sel]) sel = order()[0] || null;
    if (!sel) { box.innerHTML = `<h2 id="h-detail">나라를 고르면 자세히 보여 줍니다</h2><p class="muted">아직 고를 수 있는 나라가 없습니다.</p>`; return; }
    const c = P.countries[sel], nm = name(sel);
    const rk = (P.rank[CFG.rank] || []).indexOf(sel);
    const cats = P[CFG.cats].map((k) => [k, (c.c || {})[k] || 0]).sort((a, b) => b[1] - a[1]);
    const maxC = Math.max(1, ...cats.map((x) => x[1]));
    const top = cats[0];
    const n = c[CFG.n];
    const sent = [
      `${clock(P.asof)}까지 24시간 동안 ${ED === "invest" ? "시장 관련 " : ""}기사 ${fmt(n)}건이 ${josa(nm, "을", "를")} 다뤘습니다.`,
      c[CFG.r] != null ? `평소라면 약 ${fmt(c[CFG.b])}건이 나올 시간이라 ${ratio(c[CFG.r])}입니다.` : "평소 수준은 3일치 자료가 모이면 계산합니다.",
      top && top[1] ? `가장 많이 다룬 분야는 ${P.cats[top[0]]}(${fmt(top[1])}건)입니다.` : "",
    ].filter(Boolean).join(" ");
    box.innerHTML = `
      <div class="d-head"><h2 id="h-detail">${esc(nm)}</h2><a href="/c/${sel.toLowerCase()}/">${esc(nm)} 페이지</a></div>
      <p class="d-sent">${esc(sent)}</p>
      <dl class="figs">
        <div><dt># ${esc(CFG.metric)}</dt><dd class="figure">${c[CFG.key]}</dd><dd class="sub">${rk >= 0 ? `${rk + 1}위` : "순위 밖"}</dd></div>
        <div><dt># 24시간 ${ED === "invest" ? "시장 관련 " : ""}기사</dt><dd class="figure">${fmt(n)}</dd><dd class="sub">${c[CFG.b] == null ? "평소 수준 계산 중" : `평소 약 ${fmt(c[CFG.b])}건`}</dd></div>
        <div><dt># 평소 대비</dt><dd class="figure">${ratio(c[CFG.r])}</dd><dd class="sub">전체 기사 중 몫으로 비교</dd></div>
        <div><dt># 논조</dt><dd class="figure">${c.t == null ? "없음" : c.t.toFixed(1)}</dd><dd class="sub">${c.dt == null ? "평소 값 계산 중" : `평소보다 ${sign(c.dt)}`}</dd></div>
      </dl>
      <div class="d-grid">
        <div><h3>최근 7일 기사 수</h3>${bars7(c[CFG.s] || [])}<p class="note">마지막 막대는 오늘 기준 시각까지입니다.</p></div>
        <div><h3>분야별 기사 수</h3><table class="cats"><tbody>${cats.map(([k, v]) => `<tr><th scope="row">${esc(P.cats[k])}</th><td class="num">${fmt(v)}</td><td class="barcell"><span class="hbar" style="--v:${(v / maxC).toFixed(3)}"></span></td></tr>`).join("")}</tbody></table><p class="note">한 기사가 여러 분야에 들 수 있습니다.</p></div>
      </div>
      <div class="lists" id="d-lists"><p class="state">인물·장소·언론을 받는 중</p></div>
      <div class="arts-wrap" id="d-arts"></div>`;
    fillDetail();
  }
  async function fillDetail() {
    const want = sel;
    try {
      if (!D) D = await getJSON("/data/detail.json");
    } catch (err) {
      const l = $("#d-lists");
      if (l) l.innerHTML = `<p class="state err">인물·장소·언론 자료를 받지 못했습니다.</p>`;
      return;
    }
    if (want !== sel) return;
    const d = (D.countries || {})[sel] || { p: [], l: [], src: [], a: [] };
    const list = (xs, unit) => (xs.length ? `<ol class="plain">${xs.map(([k, v]) => `<li><span>${esc(k)}</span><span class="num muted">${fmt(v)}${unit}</span></li>`).join("")}</ol>` : `<p class="muted">아직 없습니다.</p>`);
    $("#d-lists").innerHTML = `<div><h3>많이 나온 인물</h3>${list(d.p, "건")}</div><div><h3>많이 나온 장소</h3>${list(d.l, "회")}</div><div><h3>많이 다룬 언론</h3>${list(d.src, "건")}</div>`;
    $("#d-arts").innerHTML = `<h3>최근 기사</h3>${d.a.length ? `<ul class="arts">${d.a.map(([t, u, s, ks]) => `<li><span class="num muted">${esc(t)}</span><span>${esc(s)}</span><span class="tags">${ks.map((k) => `<span class="tag">${esc(P.cats[k])}</span>`).join("")}</span><a href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">원문</a></li>`).join("")}</ul>` : `<p class="muted">아직 없습니다.</p>`}<p class="note">기사 제목은 언론사 저작물이라 싣지 않고 원문으로 연결합니다.</p>`;
  }

  // 크게 바뀐 나라
  function renderMoves() {
    let surge = P.rank.surge || [];
    if (ED === "invest") {
      surge = Object.keys(P.countries).filter((i) => P.countries[i].ir != null && P.countries[i].ir >= 1.6 && P.countries[i].i >= 50)
        .sort((a, b) => P.countries[b].ir - P.countries[a].ir).slice(0, 15);
    }
    $("#surge").innerHTML = surge.length ? surge.slice(0, 12).map((iso) => {
      const c = P.countries[iso];
      return `<tr data-iso="${iso}" tabindex="0"><td>${esc(name(iso))}</td><td class="num">${fmt(c[CFG.n])}</td><td class="num">${ratio(c[CFG.r])}</td></tr>`;
    }).join("") : `<tr><td colspan="3" class="muted">${P.baseline_days < 3 ? `평소 수준을 계산할 자료가 ${P.baseline_days}일치뿐이라 아직 고르지 않습니다.` : "기사 100건 넘는 나라 중 평소의 1.6배를 넘은 곳이 없습니다."}</td></tr>`;
    const risk = P.rank.risk || [];
    $("#risk").innerHTML = risk.length ? risk.slice(0, 12).map((iso) => {
      const c = P.countries[iso];
      return `<tr data-iso="${iso}" tabindex="0"><td>${esc(name(iso))}</td><td class="num">${fmt(c.i)}</td><td class="num">${sign(c.dt)}</td></tr>`;
    }).join("") : `<tr><td colspan="3" class="muted">${P.baseline_days < 3 ? "평소 논조를 계산할 자료가 아직 모자랍니다." : "평소보다 논조가 나빠진 나라가 없습니다."}</td></tr>`;
    for (const id of ["#surge", "#risk"]) {
      const t = $(id);
      t.onclick = (e) => { const tr = e.target.closest("tr[data-iso]"); if (tr) select(tr.dataset.iso, true); };
      t.onkeydown = (e) => { const tr = e.target.closest("tr[data-iso]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(tr.dataset.iso, true); } };
    }
  }

  // 분야별 48시간
  function spark(vals) {
    const w = 240, h = 48, max = Math.max(1, ...vals), n = vals.length;
    const pts = vals.map((v, i) => [((i / (n - 1)) * w).toFixed(1), (h - 2 - (v / max) * (h - 4)).toFixed(1)]);
    const line = pts.map((p) => p.join(",")).join(" ");
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon class="ar" points="0,${h} ${line} ${w},${h}"></polygon><polyline class="ln" points="${line}"></polyline></svg>`;
  }
  function renderMultiples() {
    const gl = P.global;
    $("#multiples").innerHTML = P[CFG.cats].map((k) => `<div class="mult"><div class="top"><span>${esc(P.cats[k])}</span><span class="v num">${fmt(gl.c[k])}</span></div>${spark(gl.hs[k])}</div>`).join("") + `<p class="note">숫자는 최근 24시간 기사 수, 선은 48시간 동안 시간별 기사 수입니다.</p>`;
  }

  // 경제 일정(투자자판)
  async function renderCal() {
    if (ED !== "invest") return;
    const ol = $("#cal-list");
    try {
      const cal = await getJSON("/data/calendar.json");
      const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const end = new Date(Date.now() + (9 + 24 * 21) * 3600e3).toISOString().slice(0, 10);
      const items = (cal.items || []).filter((x) => x.date >= today && x.date <= end);
      const dow = (d) => "일월화수목금토"[new Date(`${d}T12:00:00+09:00`).getUTCDay()];
      ol.innerHTML = items.length ? items.map((x) => `<li><span class="num">${x.date.slice(5).replace("-", ".")} (${dow(x.date)})</span><span class="num muted">${esc(x.time === "—" ? "미정" : x.time)}</span><span>${esc(x.title)}</span>${x.imp >= 3 ? `<span class="imp">중요</span>` : "<span></span>"}</li>`).join("")
        : `<li class="state">앞으로 3주 안에 잡힌 공개 일정이 없습니다.</li>`;
    } catch (err) {
      ol.innerHTML = `<li class="state err">경제 일정을 받지 못했습니다.</li>`;
    }
  }

  function renderAll(first) {
    document.title = ED === "invest" ? "시장 관련 보도가 몰린 나라 | 월드펄스 투자자판" : "전 세계 언론이 지금 다루는 나라 | 월드펄스";
    $("#h-board").textContent = CFG.h1;
    $("#lead").textContent = CFG.lead;
    for (const a of document.querySelectorAll(".eds a")) if (a.dataset.ed === ED) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    $("#asof").textContent = `GDELT ${clock(P.asof)} 기준`;
    if (cat !== "all" && !P[CFG.cats].includes(cat)) cat = "all";
    computeLevels();
    renderChips();
    renderLegend();
    renderRank();
    paintMap();
    renderDetail();
    if (first) { renderMoves(); renderMultiples(); renderCal(); }
  }

  function showError() {
    $("#asof").textContent = "자료를 받지 못했습니다";
    $("#rank-body").innerHTML = `<tr><td colspan="5"><p class="err">자료를 받지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.</p><button type="button" class="retry" id="retry">다시 받기</button></td></tr>`;
    $("#retry").onclick = (e) => { e.target.disabled = true; start(); };
    const ms = $("#map-state");
    if (ms) ms.textContent = "자료가 없어 지도를 칠하지 못했습니다";
  }

  async function start() {
    try {
      P = await getJSON("/data/pulse.json");
    } catch (err) {
      showError();
      return;
    }
    bindRank();
    renderAll(true);
    await drawMap();
    setInterval(async () => {
      try {
        const np = await getJSON("/data/pulse.json");
        if (np.asof !== P.asof) { P = np; D = null; renderAll(true); }
      } catch (err) { /* 다음 차례에 다시 받는다 */ }
    }, 5 * 60e3);
  }
  start();
})();
