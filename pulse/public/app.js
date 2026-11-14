// 월드펄스 화면(D안). 자료: /data/pulse.json(나라별 지수·사건 묶음), /data/detail.json(인물·장소·언론·기사 주소, 처음 고를 때 받음),
// /data/news.json(위키백과 주요 사건, CC BY-SA 4.0), /data/calendar.json(투자자판 경제 일정).
// 숫자 출처: GDELT 15분 파일(GKG·사건)을 월드펄스 수집기(pulse/collect)가 센 값. 시세·기사 제목은 쓰지 않는다.
(() => {
  "use strict";
  const ED = location.pathname.startsWith("/invest") ? "invest" : "general";
  document.body.dataset.ed = ED;
  const CFG = {
    general: { key: "g", n: "n", r: "r", b: "b", s: "s", h: "h", rank: "general", cats: "general_cats", all: "전체", metric: "보도 지수",
      h1: "전 세계 언론이 지금 다루는 나라", mapT: "세계 보도 지수", rankT: "지금 많이 다루는 나라", topT: "가장 많이 다룬 나라",
      lead: "최근 24시간 기사 수와 평소 대비 변화로 매긴 0~100 점수입니다.", art: "기사" },
    invest: { key: "gi", n: "i", r: "ir", b: "ib", s: "si", h: "hi", rank: "invest", cats: "invest_cats", all: "시장 전체", metric: "시장 보도 지수",
      h1: "시장 관련 보도가 몰린 나라", mapT: "시장 보도 지수", rankT: "시장 보도가 몰린 나라", topT: "시장 보도가 가장 많은 나라",
      lead: "경제·시장·에너지·무역 기사만 세어 매긴 0~100 점수입니다. 투자 권유가 아닙니다.", art: "시장 기사" },
  }[ED];
  const STEPS = 7;
  const SHOW = 12;
  const $ = (s, r = document) => r.querySelector(s);
  const params = new URLSearchParams(location.search);
  let P = null, D = null, N = null, B = null, evOpen = null, paths = null, expanded = false, view = "48h", newsDay = null, newsAll = false;
  let sel = (params.get("c") || "").toUpperCase() || null;
  let cat = params.get("cat") || "all";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n == null ? "없음" : Number(n).toLocaleString("ko-KR"));
  const ratio = (r) => (r == null ? "계산 중" : `${r.toFixed(1)}배`);
  const sign = (x) => (x > 0 ? "+" : "") + x.toFixed(1);
  const josa = (w, a, b) => { const c = (w || "").charCodeAt((w || "").length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? a : b); };
  const clock = (iso) => (iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 ${iso.slice(11, 16)}` : "알 수 없음");
  const DOW = "일월화수목금토";
  const dow = (d) => DOW[new Date(`${d}T12:00:00+09:00`).getUTCDay()];
  const name = (iso) => (P.meta[iso] || {}).ko || iso;
  const safeUrl = (u) => (/^https?:\/\//.test(u) ? u : "#");
  const flag = (iso) => `<img class="flag" src="/flags/${iso.toLowerCase()}.svg" alt="" width="24" height="18" loading="lazy">`;
  const upDown = (r) => (r == null ? "" : r >= 1.1 ? "up" : r <= 0.9 ? "down" : "");
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
  const spark = (vals) => (vals && vals.length > 1 ? line(vals, 64, 24).svg : "");

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

  // 요약 숫자 네 칸
  function renderKpis() {
    const top = (P.rank[CFG.rank] || [])[0], sg = surgeList()[0];
    const cats = P[CFG.cats].map((k) => [k, P.global.c[k] || 0]).sort((a, b) => b[1] - a[1]);
    const who = (iso) => `<button type="button" class="kv" data-iso="${iso}">${flag(iso)}<span>${esc(name(iso))}</span></button>`;
    const txt = (t) => `<span class="kv"><span>${esc(t)}</span></span>`;
    const tc = top && P.countries[top], sc = sg && P.countries[sg];
    const tiles = [
      ["24시간 전 세계 기사", txt(fmt(P.global.n)), ED === "invest" ? `그중 시장·금리 분야 ${fmt(P.global.c.markets)}건` : "GDELT가 모은 영어와 65개 언어 기사"],
      [CFG.topT, top ? who(top) : txt("없음"), tc ? `${fmt(tc[CFG.n])}건, 평소의 ${ratio(tc[CFG.r])}` : "자료를 모으는 중입니다"],
      ["평소보다 가장 크게 늘어난 나라", sg ? who(sg) : txt("아직 없음"), sc ? `평소의 ${ratio(sc[CFG.r])}, ${why(sg) || `${fmt(sc[CFG.n])}건`}` : P.baseline_days < 3 ? "평소 수준을 계산하는 중입니다" : "평소의 1.6배를 넘은 곳이 없습니다"],
      ["가장 많이 다룬 분야", txt(cats[0] ? P.cats[cats[0][0]] : "없음"), cats[1] ? `${fmt(cats[0][1])}건, 2위 ${P.cats[cats[1][0]]}` : ""],
    ];
    $("#kpis").innerHTML = tiles.map(([l, v, s]) => `<div class="kpi"><span class="kl">${esc(l)}</span>${v}<span class="ks">${esc(s)}</span></div>`).join("");
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
        .attr("aria-label", "나라별 지수 지도. 오른쪽 순위에서 같은 내용을 볼 수 있습니다.");
      const g = svg.append("g");
      paths = g.selectAll("path").data(feats).join("path").attr("d", path).attr("class", "cty nd")
        .on("click", (e, f) => { if (f.iso && P.countries[f.iso]) select(f.iso, false); })
        .on("mousemove", (e, f) => tip(e, f.iso, f.properties.name))
        .on("mouseleave", () => { $("#tip").hidden = true; });
      const z = d3.zoom().scaleExtent([1, 8]).translateExtent([[0, 0], [W, H]])
        .filter((e) => (e.type.startsWith("touch") ? e.touches && e.touches.length > 1 : e.type === "wheel" ? e.ctrlKey || e.metaKey : !e.button))
        .on("zoom", (e) => g.attr("transform", e.transform));
      svg.call(z).on("dblclick.zoom", null);
      paintMap();
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
      const rt = cat === "all" ? `<span class="rt ${upDown(c[CFG.r])}">${ratio(c[CFG.r])}</span>` : `<span class="rt">${Math.round((100 * c.c[cat]) / Math.max(1, c.n))}%</span>`;
      return `<li data-iso="${iso}" aria-selected="${iso === sel}"><span class="rn">${k + 1}</span>${cname(iso)}<span class="sp">${spark(c[CFG.h])}</span><span class="ix">${v}</span>${rt}</li>`;
    };
    // 접힌 상태에서 고른 나라가 12위 밖이면 그 줄만 아래에 덧붙인다
    ol.innerHTML = (expanded ? ord : ord.slice(0, SHOW)).map(row).join("")
      + (!expanded && selAt >= SHOW ? `<li class="gap" aria-hidden="true"></li>${row(sel, selAt)}` : "");
  }

  // 목록 줄을 누르면 그 나라를 고른다. 이름 링크는 새 탭(Ctrl·⌘·Shift)으로 열 때만 그대로 둔다.
  function bindPick(el, scroll) {
    el.addEventListener("click", (e) => {
      const li = e.target.closest("[data-iso]");
      if (!li || !el.contains(li)) return;
      if (e.target.closest("a") && (e.metaKey || e.ctrlKey || e.shiftKey)) return;
      e.preventDefault();
      select(li.dataset.iso, scroll);
    });
  }

  function select(iso, scroll) {
    sel = iso;
    setURL();
    for (const li of document.querySelectorAll("#rank li[data-iso]")) li.setAttribute("aria-selected", li.dataset.iso === sel);
    if (!expanded || !document.querySelector(`#rank li[data-iso="${iso}"]`)) renderRank();
    paintMap();
    renderDetail();
    if (scroll || innerWidth < 1100) $("#detail").scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  // 나라 자세히
  function hourLabel(i, n) {
    const hs = P.global && P.global.h;
    if (hs && hs.length === n && /^\d{10}$/.test(hs[i])) {
      const s = hs[i];
      const t = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)) + 9 * 3600e3);
      return `${t.getUTCDate()}일 ${String(t.getUTCHours()).padStart(2, "0")}시대`;
    }
    return `${n - i}시간 전`;
  }
  function chartHTML(c) {
    if (view === "7d") {
      const vals = c[CFG.s] || [];
      if (!vals.length) return { html: `<div class="empty">날짜별 기사 수가 아직 없습니다</div>`, axis: "" };
      const W = 700, H = 150, max = Math.max(1, ...vals), gap = 18, bw = (W - gap * 6) / 7;
      const bars = vals.map((v, i) => {
        const bh = Math.max(2, (v / max) * (H - 8)), x = i * (bw + gap), y = H - bh, r = Math.min(4, bh / 2);
        return `<path class="bar7${i === vals.length - 1 ? " now" : ""}" d="M${x},${H}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${H}Z"><title>${P.days[i]} ${fmt(v)}건</title></path>`;
      }).join("");
      const pts = vals.map((v, i) => ({ x: ((i * (bw + gap) + bw / 2) / W) * 100, y: ((H - Math.max(2, (v / max) * (H - 8))) / H) * 100,
        t: `${+P.days[i].slice(5, 7)}.${P.days[i].slice(8)}(${dow(P.days[i])}) ${fmt(v)}건${i === vals.length - 1 ? `, ${P.asof.slice(11, 16)}까지` : ""}` }));
      return { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 7일 날짜별 ${CFG.art} 수">${bars}<line class="gl" x1="0" x2="${W}" y1="${H}" y2="${H}"/></svg>`, pts,
        axis: `<div class="axis axis7">${P.days.map((d, i) => `<span>${i === P.days.length - 1 ? "오늘" : `${+d.slice(8)}일`}</span>`).join("")}</div>` };
    }
    const vals = c[CFG.h];
    if (!vals || vals.length < 2) return { html: `<div class="empty">기사가 적어 시간별 흐름은 그리지 않습니다</div>`, axis: "" };
    const W = 700, H = 150, n = vals.length, L = line(vals, W, H, { area: true, pad: 6, cls: "big" });
    const pts = vals.map((v, i) => ({ x: (i / (n - 1)) * 100, y: (L.ys[i] / H) * 100, t: `${hourLabel(i, n)} ${fmt(v)}건` }));
    return { html: L.svg.replace("<svg ", `<svg role="img" aria-label="최근 48시간 시간별 ${CFG.art} 수, 가장 많은 시간 ${fmt(Math.max(...vals))}건" `).replace(' aria-hidden="true"', "")
      + "", pts, axis: `<div class="axis"><span>48시간 전</span><span>24시간 전</span><span>${P.asof.slice(11, 16)}</span></div>` };
  }
  // 그래프 위에 손가락·마우스를 올리면 가까운 점의 값을 보여 준다
  function hover(box, pts) {
    if (!pts || !pts.length) return;
    const ln = document.createElement("div"), dot = document.createElement("div"), tp = document.createElement("div");
    ln.className = "hline"; dot.className = "hdot"; tp.className = "htip";
    for (const el of [ln, dot, tp]) { el.hidden = true; box.appendChild(el); }
    const step = pts.length > 1 ? pts[1].x - pts[0].x : 100;
    box.onpointermove = (e) => {
      const r = box.getBoundingClientRect();
      const fx = ((e.clientX - r.left) / r.width) * 100;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round((fx - pts[0].x) / step)));
      const p = pts[i];
      ln.style.left = `${p.x}%`; dot.style.left = `${p.x}%`; dot.style.top = `${p.y}%`;
      tp.textContent = p.t; tp.style.left = `${p.x}%`;
      tp.style.transform = `translate(${p.x < 18 ? "0" : p.x > 82 ? "-100%" : "-50%"}, -100%)`;
      ln.hidden = dot.hidden = tp.hidden = false;
    };
    box.onpointerleave = () => { ln.hidden = dot.hidden = tp.hidden = true; };
  }
  function renderChart(c) {
    const ch = chartHTML(c);
    const box = $("#chart");
    box.innerHTML = ch.html;
    $("#chart-axis").innerHTML = ch.axis;
    hover(box, ch.pts);
  }
  function renderDetail() {
    const box = $("#detail");
    if (!sel || !P.countries[sel]) sel = order()[0] || (P.rank[CFG.rank] || [])[0] || null;
    if (!sel) { box.innerHTML = `<h2 id="h-detail" class="subh">나라를 고르면 자세히 보여 줍니다</h2><p class="hint">아직 고를 수 있는 나라가 없습니다.</p>`; return; }
    const c = P.countries[sel], nm = name(sel);
    evOpen = null;
    const rk = (P.rank[CFG.rank] || []).indexOf(sel);
    const cats = P[CFG.cats].map((k) => [k, (c.c || {})[k] || 0]).sort((a, b) => b[1] - a[1]);
    const maxC = Math.max(1, ...cats.map((x) => x[1]));
    const top = cats[0], n = c[CFG.n];
    const sent = [
      `${clock(P.asof)}까지 24시간 동안 ${ED === "invest" ? "시장 관련 " : ""}기사 ${fmt(n)}건이 ${josa(nm, "을", "를")} 다뤘습니다.`,
      c[CFG.r] != null ? `평소라면 약 ${fmt(c[CFG.b])}건이 나올 시간이라 평소의 ${ratio(c[CFG.r])}입니다.` : "평소 수준은 3일치 자료가 모이면 계산합니다.",
      top && top[1] ? `가장 많이 다룬 분야는 ${P.cats[top[0]]}(${fmt(top[1])}건)입니다.` : "",
    ].filter(Boolean).join(" ");
    box.innerHTML = `
      <div class="det">
        <div>
          <div class="dh">${flag(sel).replace('loading="lazy"', "")}<h2 id="h-detail">${esc(nm)}</h2><span class="badge">${rk >= 0 ? `${rk + 1}위` : "순위 밖"}</span><a class="page" href="/c/${sel.toLowerCase()}/">${esc(nm)} 페이지</a></div>
          <p class="dsent">${esc(sent)}</p>
          ${whatHTML(sel)}
          <div class="dnum">
            <div><span class="dv">${c[CFG.key]}</span><span class="dl">${esc(CFG.metric)}</span></div>
            <div><span class="dv">${fmt(n)}</span><span class="dl">24시간 ${esc(CFG.art)}</span></div>
            <div><span class="dv">${ratio(c[CFG.r])}</span><span class="dl">${c[CFG.b] == null ? "평소 대비" : `평소 약 ${fmt(c[CFG.b])}건 대비`}</span></div>
            <div><span class="dv">${c.t == null ? "없음" : c.t.toFixed(1)}</span><span class="dl">논조${c.dt == null ? "" : Math.abs(c.dt) < 0.05 ? ", 평소와 같음" : `, 평소보다 ${sign(c.dt)}`}</span></div>
          </div>
          <div class="chart-h"><h3 class="subh">${view === "7d" ? "날짜별" : "시간별"} ${esc(CFG.art)} 수</h3><div class="seg" role="group" aria-label="기간"><button type="button" data-view="48h" aria-pressed="${view === "48h"}">48시간</button><button type="button" data-view="7d" aria-pressed="${view === "7d"}">7일</button></div></div>
          <div class="chart" id="chart"></div><div id="chart-axis"></div>
        </div>
        <div>
          <h3 class="subh">분야별 기사</h3>
          <ul class="cats">${cats.map(([k, v]) => `<li><span>${esc(P.cats[k])}</span><span class="cb" aria-hidden="true"><i style="width:${((v / maxC) * 100).toFixed(1)}%"></i></span><span class="cv">${fmt(v)}</span></li>`).join("")}</ul>
          <p class="note">한 기사가 여러 분야에 들 수 있습니다. 논조는 GDELT가 단어로 계산한 평균이며 0보다 작으면 부정적인 단어가 많다는 뜻입니다.</p>
        </div>
      </div>
      <div class="extra" id="d-extra"><p class="state">인물·장소·언론을 받는 중</p></div>`;
    $(".seg", box).onclick = (e) => {
      const b = e.target.closest("[data-view]");
      if (!b || b.dataset.view === view) return;
      view = b.dataset.view;
      for (const x of box.querySelectorAll(".seg button")) x.setAttribute("aria-pressed", x.dataset.view === view);
      $(".chart-h .subh", box).textContent = `${view === "7d" ? "날짜별" : "시간별"} ${CFG.art} 수`;
      renderChart(c);
    };
    renderChart(c);
    fillDetail();
  }
  // 무슨 일이 있었나: GDELT 사건 묶음(예시 기사는 detail.json을 받은 뒤 링크로 바뀐다) + 위키백과 주요 사건 중 이 나라
  function whatHTML(iso) {
    const es = (P.countries[iso] || {}).e || [];
    const ai = B && (B.countries || {})[iso];
    const aiHTML = ai ? `<p class="aisum"><span class="ait">AI 요약</span>${esc(ai.s)}</p>${ai.k && ai.k.length ? `<p class="aik">${ai.k.map((k) => `<span class="tag">${esc(k)}</span>`).join("")}</p>` : ""}` : "";
    const chips = es.map(([g, n, r, b]) => `<button type="button" class="evc" data-g="${g}" aria-expanded="false" aria-controls="evp"><b>${esc(evName(g))}</b> ${fmt(n)}건${r != null ? ` <i class="${r >= 1.5 ? "up" : r <= 0.67 ? "down" : ""}">${evRatio(r, b)}</i>` : ""}</button>`).join("");
    const wl = newsFor(iso).slice(0, 3);
    if (!ai && !chips && !wl.length) return `<div class="what"><h3 class="subh">무슨 일이 있었나</h3><p class="hint">두드러진 사건이 아직 잡히지 않았습니다.</p></div>`;
    return `<div class="what"><h3 class="subh">무슨 일이 있었나</h3>
      ${aiHTML}
      ${chips ? `<div class="evs">${chips}</div><div class="evp" id="evp" hidden></div>` : ""}
      ${wl.length ? `<ul class="wl">${wl.map(([d, it]) => `<li><span class="wd">${dd(d)}</span><span>${it.topic ? `<span class="topic">${esc(it.kp || it.topic)}</span>` : ""}${wtext(it)}${srcLinks(it.src)}${bgHTML(it)}</span></li>`).join("")}</ul>` : ""}
      <p class="note">${chips ? "사건 종류를 누르면 뜻과 시간별 흐름, 예시 기사가 펼쳐집니다. " : ""}${ai ? `AI 요약은 이 나라를 다룬 기사 제목 ${ai.m}개를 Claude가 읽고 새로 쓴 문장(${B.at.slice(11, 16)} 기준)이라 틀릴 수 있습니다. ` : ""}${chips ? `사건 종류는 GDELT가 기사 첫머리 문장을 기계로 분류한 것이라 틀릴 수 있습니다. 숫자는 그 사건을 다룬 기사 수${P.ev_days >= 3 ? "" : "이고, 평소 수준은 사건 자료가 3일치 모이면 계산합니다"}.` : ""}${wl.length ? `${chips ? " " : ""}문장은 위키백과 주요 사건${wl.some(([, it]) => it.ko) ? "을 AI로 옮긴 것" : "(영어 원문)"}입니다.` : ""}</p></div>`;
  }
  // 위키백과 문장: 한국어 번역(ko·kp)이 있으면 그것을, '원문' 단추로 영어를 펼친다
  const wtext = (it) => `${esc(it.ko || it.text)}${it.ko ? ` <button type="button" class="orig" aria-expanded="false">원문</button><span class="en" hidden>${esc(it.text)}</span>` : ""}`;
  // 사건 종류 상자: 뜻, 24시간 기사 수와 평소 대비, 시간별 막대, 예시 기사(평소의 1.5배 넘게 늘어난 종류만)
  function bars24(vals) {
    const W = 480, H = 64, max = Math.max(1, ...vals), gap = 3, bw = (W - gap * (vals.length - 1)) / vals.length;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 24시간 시간별 기사 수, 가장 많은 시간 ${fmt(Math.max(...vals))}건">${vals.map((v, i) => {
      const h = v ? Math.max(2, (v / max) * (H - 2)) : 0;
      return `<rect class="bar7" x="${(i * (bw + gap)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"><title>${hourLabel(48 - vals.length + i, 48)} ${fmt(v)}건</title></rect>`;
    }).join("")}<line class="gl" x1="0" x2="${W}" y1="${H}" y2="${H}"/></svg>`;
  }
  function evPanel(g) {
    const box = $("#evp");
    if (!box) return;
    const e = ((P.countries[sel] || {}).e || []).find((x) => x[0] === g);
    if (!e) { box.hidden = true; return; }
    const [, n, r, b] = e;
    const d = D && (D.countries || {})[sel];
    const hs = d && (d.evh || {})[g];
    const ex = d && (d.ev || {})[g];
    const list = ex ? (Array.isArray(ex[0]) ? ex : [ex]) : null;
    box.innerHTML = `
      <div class="evp-h"><b>${esc(evName(g))}</b><span>${esc((P.evd || {})[g] || "")}</span></div>
      <p class="evp-n">24시간 동안 이 종류의 사건을 다룬 기사 <b>${fmt(n)}건</b>${b != null ? `, 평소라면 약 ${fmt(Math.round(b))}건${r != null ? `(${evRatio(r, b)})` : ""}` : ""}입니다.</p>
      ${hs ? `<div class="evp-c">${bars24(hs)}</div><div class="axis"><span>24시간 전</span><span>12시간 전</span><span>${P.asof.slice(11, 16)}</span></div>` : d ? "" : `<p class="hint">시간별 흐름을 받는 중</p>`}
      ${list ? `<h4 class="subh">예시 기사</h4><ul class="arts">${list.map(([u, dom, t]) => `<li><span class="t">${t ? esc(t.replace("-", ".")) : ""}</span><span class="s"><span class="src">${esc(dom)}</span></span><a href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">원문 보기</a></li>`).join("")}</ul>`
        : r != null && r < 1.5 ? `<p class="hint">평소 수준이라 예시 기사는 싣지 않습니다.</p>` : d ? `<p class="hint">예시 기사가 아직 없습니다.</p>` : ""}
      <p class="note">GDELT가 기사 첫머리 문장을 기계로 분류한 결과라 엉뚱한 기사가 섞일 수 있습니다.</p>`;
    box.hidden = false;
  }

  // 배경: 그 사건 위키백과 문서의 첫 문단(번역이 있으면 한국어), 펼쳐 보기
  const bgHTML = (it) => (it.bg ? `<details class="wbg"><summary>배경 보기</summary><p>${esc(it.bgk || it.bg)}</p>${it.wu ? `<a href="${esc(safeUrl(it.wu))}" rel="noopener" target="_blank">위키백과 문서: ${esc(it.wt)}</a>` : ""}</details>` : "");
  const srcLinks = (src) => (src || []).map(([l, u]) => ` <a class="srcl" href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">${esc(l)}</a>`).join("");
  function newsFor(iso) {
    if (!N) return [];
    const out = [];
    for (const d of N.days || []) for (const it of d.items) if ((it.c || []).includes(iso)) out.push([d.date, it]);
    return out;
  }

  async function fillDetail() {
    const want = sel;
    try {
      if (!D) D = await getJSON("/data/detail.json");
    } catch (err) {
      const l = $("#d-extra");
      if (l) l.innerHTML = `<p class="state err">인물·장소·언론 자료를 받지 못했습니다. 잠시 뒤 다른 나라를 골랐다가 다시 골라 주세요.</p>`;
      return;
    }
    if (want !== sel || !$("#d-extra")) return;
    const d = (D.countries || {})[sel] || { p: [], l: [], src: [], a: [] };
    if (evOpen) evPanel(evOpen);
    const list = (xs, unit) => (xs.length ? `<ol class="plain">${xs.slice(0, 8).map(([k, v]) => `<li><span>${esc(k)}</span><span class="v">${fmt(v)}${unit}</span></li>`).join("")}</ol>` : `<p class="state">아직 없습니다.</p>`);
    const arts = d.a.length ? `<ul class="arts">${d.a.slice(0, 10).map(([t, u, s, ks]) => `<li><span class="t">${esc(t.replace("-", "."))}</span><span class="s"><span class="src">${esc(s)}</span>${ks.length ? `<span class="tags">${ks.slice(0, 3).map((k) => `<span class="tag">${esc(P.cats[k] || k)}</span>`).join("")}</span>` : ""}</span><a href="${esc(safeUrl(u))}" rel="nofollow noopener" target="_blank">원문 보기</a></li>`).join("")}</ul>` : `<p class="state">아직 없습니다.</p>`;
    $("#d-extra").innerHTML = `<div><h3 class="subh">많이 나온 인물</h3>${list(d.p, "건")}</div><div><h3 class="subh">많이 나온 장소</h3>${list(d.l, "회")}</div><div><h3 class="subh">많이 다룬 언론</h3>${list(d.src, "건")}</div><div class="artsbox"><h3 class="subh">최근 기사</h3>${arts}<p class="note">기사 제목은 언론사 저작물이라 싣지 않고 원문으로 연결합니다.</p></div>`;
  }

  // 크게 바뀐 나라
  function miniRows(list, cols, empty, withWhy) {
    if (!list.length) return `<li class="state">${esc(empty)}</li>`;
    return `<li class="h" aria-hidden="true"><span>나라</span><span class="n">${cols[0]}</span><span class="x">${cols[1]}</span></li>` + list.slice(0, 10).map((iso) => {
      const [n, x, cls] = cols[2](P.countries[iso]);
      const w = withWhy && why(iso);
      return `<li data-iso="${iso}"><span class="nmw">${cname(iso)}${w ? `<span class="why">${esc(w)}</span>` : ""}</span><span class="n">${n}</span><span class="x ${cls}">${x}</span></li>`;
    }).join("");
  }
  function renderMoves() {
    $("#surge").innerHTML = miniRows(surgeList(), [CFG.art, "평소 대비", (c) => [fmt(c[CFG.n]), ratio(c[CFG.r]), "up"]],
      P.baseline_days < 3 ? `평소 수준을 계산할 자료가 ${P.baseline_days}일치뿐이라 아직 고르지 않습니다.` : `${ED === "invest" ? "시장 기사 50건" : "기사 100건"} 넘는 나라 중 평소의 1.6배를 넘은 곳이 없습니다.`, true);
    $("#risk").innerHTML = miniRows(P.rank.risk || [], ["시장 기사", "논조 변화", (c) => [fmt(c.i), sign(c.dt), "down"]],
      P.baseline_days < 3 ? "평소 논조를 계산할 자료가 아직 모자랍니다." : "평소보다 논조가 나빠진 나라가 없습니다.");
  }

  // 투자 위험 신호(투자자판): rank.alert 순서, 나라마다 늘어난 위험 사건 묶음 3개까지 + AI 요약 한 줄
  function renderAlert() {
    if (ED !== "invest") return;
    const ol = $("#alerts");
    const xs = P.rank.alert || [];
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
    if (sel && $("#detail .what")) renderDetail();
    renderAlert();
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
    if (sel && $("#detail .what")) renderDetail();
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
      const LIM = 10;
      const shown = newsAll ? day.items : day.items.slice(0, LIM);
      const groups = [];
      for (const it of shown) {
        let g = groups.find((x) => x[0] === it.cat);
        if (!g) groups.push((g = [it.cat, []]));
        g[1].push(it);
      }
      box.innerHTML = groups.map(([c, xs]) => `<div class="ncat"><h3 class="subh">${esc(c)}</h3><ul class="nl">${xs.map((it) => `<li>${(it.c || []).length ? `<span class="nfs">${it.c.slice(0, 3).map((iso) => `<button type="button" class="nf" data-iso="${iso}" title="${esc(name(iso))} 보기" aria-label="${esc(name(iso))} 보기">${flag(iso)}</button>`).join("")}</span>` : ""}<span class="nt">${it.topic ? `<span class="topic">${esc(it.kp || it.topic)}</span>` : ""}${wtext(it)}${srcLinks(it.src)}${bgHTML(it)}</span></li>`).join("")}</ul></div>`).join("");
      more.hidden = day.items.length <= LIM;
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

  // 나라 찾기
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
      if (P.countries[iso]) {
        if (cat !== "all" && !order().includes(iso)) { cat = "all"; renderAll(false); }
        select(iso, true);
      } else location.href = `/c/${iso.toLowerCase()}/`;
    };
    function show() {
      const t = q.value.trim().toLowerCase();
      if (!t) { close(); return; }
      const cnt = (iso) => (P.countries[iso] || {})[CFG.n] || 0;
      items = Object.entries(P.meta).map(([iso, m]) => ({ iso, ko: m.ko || iso, en: m.en || "" }))
        .filter((x) => x.ko.includes(t) || x.en.toLowerCase().includes(t) || x.iso.toLowerCase() === t)
        .sort((a, b) => (b.ko.startsWith(t) - a.ko.startsWith(t)) || cnt(b.iso) - cnt(a.iso)).slice(0, 8);
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
    for (const a of document.querySelectorAll(".tabs a")) if (a.dataset.ed === ED) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    document.title = ED === "invest" ? "시장 관련 보도가 몰린 나라 | 월드펄스 투자자판" : "전 세계 언론이 지금 다루는 나라 | 월드펄스";
    $("#h-board").textContent = CFG.h1;
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
    renderDetail();
    if (first) { renderKpis(); renderMoves(); renderAlert(); renderMultiples(); renderCal(); }
  }

  function showError() {
    const as = $("#asof");
    as.textContent = "자료를 받지 못했습니다";
    as.classList.add("bad");
    $("#rank").innerHTML = `<li class="state"><p class="err">자료를 받지 못했습니다. 연결을 확인한 뒤 다시 받아 주세요.</p><button type="button" class="retry" id="retry">다시 받기</button></li>`;
    $("#retry").onclick = (e) => { e.target.disabled = true; e.target.textContent = "받는 중"; start(); };
    for (const k of document.querySelectorAll("#kpis .kv")) k.innerHTML = "<span>없음</span>";
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
      bindPick($("#rank"), false);
      bindPick($("#surge"), true);
      bindPick($("#risk"), true);
      bindPick($("#alerts"), true);
      $("#kpis").addEventListener("click", (e) => { const b = e.target.closest("button[data-iso]"); if (b) select(b.dataset.iso, true); });
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
      $("#detail").addEventListener("click", (e) => {
        const c = e.target.closest(".evc[data-g]");
        if (!c) return;
        const open = c.getAttribute("aria-expanded") !== "true";
        for (const x of document.querySelectorAll("#detail .evc[data-g]")) x.setAttribute("aria-expanded", "false");
        evOpen = open ? c.dataset.g : null;
        if (open) { c.setAttribute("aria-expanded", "true"); evPanel(evOpen); } else $("#evp").hidden = true;
      });
      $("#news-list").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-iso]");
        if (!b) return;
        if (P.countries[b.dataset.iso]) select(b.dataset.iso, true); else location.href = `/c/${b.dataset.iso.toLowerCase()}/`;
      });
      initSearch();
      setInterval(async () => {
        try {
          const np = await getJSON("/data/pulse.json");
          if (np.asof !== P.asof) { P = np; D = null; renderAll(true); }
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
