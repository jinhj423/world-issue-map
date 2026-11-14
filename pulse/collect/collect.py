"""월드펄스 수집기 — 상업 이용이 허용된 자료만 쓴다. AI 호출 없음(토큰 0).

자료(2026-11-14 확인):
  - GDELT 2.0 GKG 15분 파일(data.gdeltproject.org/gdeltv2/): 영어 묶음 + 번역 묶음(65개 언어).
    이용 조건: 상업 이용 포함 무료, 출처 표기와 링크 필요(gdeltproject.org/about.html#termsofuse).
    API(api.gdeltproject.org)는 GitHub 서버에서 429로 막혀 원자료 파일을 쓴다. 파일은 약 1시간 늦게 올라온다.
  - GDELT 2.0 사건 15분 파일(export, translation.export): 기사 문장을 기계로 분류한 사건 종류(CAMEO). 같은 이용 조건.
    나라별 '무슨 일'(교전·체포·시위·협정 등) 묶음과 평소 대비, 예시 기사 주소를 만든다(events.py).
  - 위키백과 Portal:Current events(영어, CC BY-SA 4.0): 그날 주요 사건 한 줄 요약 → news.json(wiki.py).
  - 미국 공공기관 경제 일정: ../../scripts/calendar_build.py의 연준·BEA·Census·고정 목록(BLS·한은)만. 실적 일정(나스닥)은 이용 조건을 확인하지 않아 뺀다.
기사 제목은 언론사 글이라 공개 자료에 넣지 않는다(SHOW_TITLES). 출처 이름·주소·분야·논조만 남긴다.

사용: python3 pulse/collect/collect.py <작업 폴더>
  작업 폴더에 state.json(누적 상태)을 읽고 pulse.json·detail.json·calendar.json·news.json을 쓴다. 바뀐 게 있으면 .changed를 만든다.
"""
from __future__ import annotations

import csv
import html
import io
import json
import math
import re
import statistics
import sys
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent.parent / "scripts")]
import countries as C  # noqa: E402
import events as E  # noqa: E402
import themes as T  # noqa: E402
import translate as TR  # noqa: E402
import wiki as W  # noqa: E402

csv.field_size_limit(1 << 30)
KST = ZoneInfo("Asia/Seoul")
UA = "world-pulse/1.0 (+https://github.com/jinhj423/world-issue-map)"
BASE = "http://data.gdeltproject.org/gdeltv2/"
KINDS = {"en": "gkg.csv.zip", "tr": "translation.gkg.csv.zip", "ev": "export.CSV.zip", "evt": "translation.export.CSV.zip"}
EV_KINDS = ("ev", "evt")
EV_DAYS = 10                  # 사건 묶음 날짜별 합(평소 수준 계산용)
NCAT = len(T.KEYS)
VLEN = 2 + NCAT + 1          # [기사 수, 논조 합, 분야별…, 투자자판]
IINV = 2 + NCAT              # 투자자판 칸
HOURS_KEEP = 50               # 나라별 시간 묶음(24시간 창 + 여유), 전체 분야 추이는 48시간
EXTRA_KEEP = 25               # 인물·장소·출처는 최근 25시간
DAYS_KEEP = 35
BACK_DAYS = 8                 # 평소 수준 계산용으로 거슬러 받는 날 수
BUDGET_S = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--budget=")), 240))
SHOW_TITLES = False
NOT_ARTICLE = re.compile(r"/(tag|tags|category|categories|topic|topics|author|search|page)/", re.I)
# 인물로 잘못 잡히는 도시·나라·직함 이름
NOT_PERSON = {"los angeles", "las vegas", "abu dhabi", "new york", "hong kong", "san francisco", "buenos aires", "tel aviv",
              "kuala lumpur", "rio de janeiro", "sao paulo", "new delhi", "cape town", "el paso", "san diego", "san jose",
              "santa clara", "costa rica", "puerto rico", "sri lanka", "saudi arabia", "new zealand", "south africa",
              "north korea", "south korea", "united states", "united kingdom", "white house", "prime minister",
              "america latin", "latin america", "middle east", "wall street", "silicon valley", "new jersey", "new mexico",
              "north carolina", "south carolina", "west virginia", "rhode island", "salt lake", "hamas israel"}
THEMES_LOG = "--themes" in sys.argv
TITLE_RE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)
TITLES_PER_FILE = 2           # AI 요약 재료: 15분 파일마다 나라별 기사 제목 2개(공개하지 않는다)
ROWS, F2I = C.load()


def get(url: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def st_dt(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def kst_day(s: str) -> str:
    return st_dt(s).astimezone(KST).date().isoformat()


def rows_of(blob: bytes):
    z = zipfile.ZipFile(io.BytesIO(blob))
    with z.open(z.namelist()[0]) as f:
        for row in csv.reader(io.TextIOWrapper(f, "utf-8", errors="replace"), delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) >= 27:
                yield row


_theme_memo: dict[str, int] = {}


def theme_mask(themes: str) -> int:
    m = 0
    for t in themes.split(";"):
        if not t:
            continue
        b = _theme_memo.get(t)
        if b is None:
            fl = T.classify({t})
            b = sum(1 << i for i, v in enumerate(fl[:NCAT]) if v)
            _theme_memo[t] = b
        m |= b
    return m


def mask_flags(m: int) -> list[int]:
    fl = [(m >> i) & 1 for i in range(NCAT)]
    fl.append(1 if any(fl[T.KEYS.index(k)] for k in T.INVEST_FROM) else 0)
    return fl


class State:
    def __init__(self, path: Path):
        self.path = path
        d = json.loads(path.read_text("utf-8")) if path.exists() else {}
        self.done = {k: set(d.get("done", {}).get(k, [])) for k in KINDS}
        self.hours = d.get("hours", {})
        self.days = d.get("days", {})
        self.dcov = d.get("dcov", {})
        self.ghours = d.get("ghours", {})
        self.pp = d.get("pp", {})
        self.links = d.get("links", {})
        self.newest = d.get("newest", "")
        self.eh, self.ed = d.get("eh", {}), d.get("ed", {})      # 사건 묶음: 시간별·날짜별 {나라: {묶음: 기사 수}}
        self.egh, self.egd = d.get("egh", {}), d.get("egd", {})  # 사건 전체(뿌리 사건 기사 수) 시간별·날짜별
        self.el = d.get("el", {})                                # 사건 예시 기사 {나라: {묶음: [[파일 시각, 주소, 기사 수]]}}
        self.tt = d.get("tt", {})                                # 기사 제목 표본 {시간: {나라: [[제목, 언론사]]}} — AI 요약 재료, 공개 안 함

    def save(self):
        newest = max([max(v) for v in self.done.values() if v] or ["0"])
        if newest != "0":
            lo = (st_dt(newest) - timedelta(days=BACK_DAYS + 1)).strftime("%Y%m%d%H%M%S")
            self.done = {k: {s for s in v if s >= lo} for k, v in self.done.items()}
        keep = lambda d, n: {k: d[k] for k in sorted(d)[-n:]}  # noqa: E731
        self.hours, self.ghours = keep(self.hours, HOURS_KEEP), keep(self.ghours, HOURS_KEEP)
        self.pp, self.days, self.dcov = keep(self.pp, EXTRA_KEEP), keep(self.days, DAYS_KEEP), keep(self.dcov, DAYS_KEEP)
        self.eh, self.egh, self.ed, self.egd = keep(self.eh, HOURS_KEEP), keep(self.egh, HOURS_KEEP), keep(self.ed, EV_DAYS), keep(self.egd, EV_DAYS)
        self.tt = keep(self.tt, EXTRA_KEEP)
        out = {"v": 1, "done": {k: sorted(v) for k, v in self.done.items()}, "hours": self.hours, "days": self.days,
               "dcov": self.dcov, "ghours": self.ghours, "pp": self.pp, "links": self.links, "newest": self.newest,
               "eh": self.eh, "ed": self.ed, "egh": self.egh, "egd": self.egd, "el": self.el, "tt": self.tt}
        self.path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")


def add(vecs: dict, iso: str, tone: float, fl: list[int]):
    v = vecs.get(iso)
    if v is None:
        v = vecs[iso] = [0] * VLEN
    v[0] += 1
    v[1] = round(v[1] + tone, 2)
    for i, x in enumerate(fl):
        v[2 + i] += x


def process(st: State, kind: str, stamp: str, blob: bytes, fips_names: dict, unknown: Counter, theme_seen: dict) -> int:
    hk, dk = stamp[:10], kst_day(stamp)
    recent = st_dt(stamp) >= datetime.now(timezone.utc) - timedelta(hours=EXTRA_KEEP + 1)
    hv = st.hours.setdefault(hk, {})
    dv = st.days.setdefault(dk, {})
    g = st.ghours.setdefault(hk, [0] * (1 + NCAT + 1))
    n = 0
    tpf: Counter = Counter()
    for row in rows_of(blob):
        isos, places_by = set(), defaultdict(Counter)
        locnames = set()
        for part in (row[9] or "").split(";"):
            f = part.split("#")
            if len(f) < 3 or not f[2]:
                continue
            iso = F2I.get(f[2])
            if not iso:
                unknown[f[2]] += 1
                if f[0] == "1":
                    fips_names[f[2]][f[1]] += 1
                continue
            isos.add(iso)
            name = f[1].split(",")[0].strip()
            locnames.add(name.lower())
            if f[0] == "1":
                fips_names[f[2]][f[1]] += 1
            elif f[0] in ("3", "4", "5") and name:
                places_by[iso][name] += 1
        if not isos:
            continue
        n += 1
        m = theme_mask(row[7] or "")
        fl = mask_flags(m)
        try:
            tone = float((row[15] or "0").split(",")[0])
        except ValueError:
            tone = 0.0
        for iso in isos:
            add(hv, iso, tone, fl)
            add(dv, iso, tone, fl)
        g[0] += 1
        for i, x in enumerate(fl):
            g[1 + i] += x
        if THEMES_LOG and len(theme_seen) < 50000:
            for t in set((row[7] or "").split(";")):
                if t:
                    theme_seen[t] = theme_seen.get(t, 0) + 1
        if not recent:
            continue
        # 주인공 나라: 본문에서 가장 먼저 나온 장소의 나라
        prim, best = None, 10 ** 9
        for part in (row[10] or "").split(";"):
            f = part.split("#")
            if len(f) >= 9 and f[2] in F2I:
                try:
                    off = int(f[8])
                except ValueError:
                    continue
                if off < best:
                    prim, best = F2I[f[2]], off
        prim = prim or sorted(isos)[0]
        ex = st.pp.setdefault(hk, {}).setdefault(prim, {"p": {}, "l": {}, "s": {}})
        for p in set((row[11] or "").split(";")):
            p = p.strip()
            pl = p.lower()
            if p and " " in p and pl not in locnames and pl not in NOT_PERSON and len(p) <= 40 and not pl.endswith((" minister", " president")):
                ex["p"][p] = ex["p"].get(p, 0) + 1
        for name, c in places_by.get(prim, {}).items():
            ex["l"][name] = ex["l"].get(name, 0) + c
        src = (row[3] or "").strip()
        if src:
            ex["s"][src] = ex["s"].get(src, 0) + 1
        url = (row[4] or "").strip()
        if url.startswith("http") and len(url) < 400 and not NOT_ARTICLE.search(url):
            st.links.setdefault(prim, []).append([stamp, url, src, m, round(tone, 1)])
            tm = TITLE_RE.search(row[26]) if len(row) > 26 and tpf[prim] < TITLES_PER_FILE else None
            title = re.sub(r"\s+", " ", html.unescape(tm.group(1))).strip() if tm else ""
            if 15 <= len(title) <= 200:
                xs = st.tt.setdefault(hk, {}).setdefault(prim, [])
                if all(title != x[0] for x in xs):
                    xs.append([title, src])
                    tpf[prim] += 1
    cov = st.dcov.setdefault(dk, {"en": 0, "tr": 0})
    cov[kind] = cov.get(kind, 0) + 1
    st.done[kind].add(stamp)
    st.newest = max(st.newest, stamp)
    return n


def process_ev(st: State, kind: str, stamp: str, blob: bytes) -> int:
    """사건 파일 하나: 기사 첫머리 사건(IsRootEvent)만, 기사 수(NumArticles)로 무게를 매겨 사건이 일어난 나라별 묶음에 더한다."""
    hk, dk = stamp[:10], kst_day(stamp)
    recent = st_dt(stamp) >= datetime.now(timezone.utc) - timedelta(hours=EXTRA_KEEP + 1)
    hv, dv = st.eh.setdefault(hk, {}), st.ed.setdefault(dk, {})
    n = tot = 0
    for f in rows_of(blob):
        if len(f) < 61 or f[25] != "1":
            continue
        try:
            w = int(f[33] or 0)
        except ValueError:
            continue
        if w <= 0:
            continue
        tot += w
        g = E.group_of(f[27], f[28])
        iso = F2I.get(f[53] or f[37])
        if not g or not iso:
            continue
        n += 1
        for d in (hv, dv):
            x = d.setdefault(iso, {})
            x[g] = x.get(g, 0) + w
        url = (f[60] or "").strip()
        if recent and url.startswith("http") and len(url) < 400 and not NOT_ARTICLE.search(url):
            st.el.setdefault(iso, {}).setdefault(g, []).append([stamp, url, w])
    st.egh[hk] = st.egh.get(hk, 0) + tot
    st.egd[dk] = st.egd.get(dk, 0) + tot
    cov = st.dcov.setdefault(dk, {"en": 0, "tr": 0})
    cov[kind] = cov.get(kind, 0) + 1
    st.done[kind].add(stamp)
    return n


def trim_pp(st: State):
    """시간 묶음마다 나라별 인물·장소·출처를 상위 몇 개만, 기사 주소는 나라마다 최근 40개만 남긴다(상태 파일 크기)."""
    for hk, by in st.pp.items():
        for iso, ex in by.items():
            for k, n in (("p", 8), ("l", 5), ("s", 5)):
                ex[k] = dict(Counter(ex[k]).most_common(n))
    for iso, lk in st.links.items():
        lk.sort(key=lambda x: x[0])
        del lk[: max(0, len(lk) - 40)]
    # 사건 예시 기사: 나라·묶음마다 최근 26시간 안에서 기사 수가 많은 주소 3개
    cut = (datetime.now(timezone.utc) - timedelta(hours=EXTRA_KEEP + 1)).strftime("%Y%m%d%H%M%S")
    for iso in list(st.el):
        for g in list(st.el[iso]):
            seen, xs = set(), []
            for x in sorted(st.el[iso][g], key=lambda x: -x[2]):
                if x[0] >= cut and x[1] not in seen:
                    seen.add(x[1])
                    xs.append(x)
            if xs:
                st.el[iso][g] = xs[:3]
            else:
                del st.el[iso][g]
        if not st.el[iso]:
            del st.el[iso]


def latest_listed(kind: str) -> str | None:
    name = "lastupdate-translation.txt" if kind in ("tr", "evt") else "lastupdate.txt"
    try:
        lines = get(BASE + name, 30).decode().split()
    except Exception as e:  # noqa: BLE001
        print(f"  ! {name}: {e}")
        return None
    for u in lines:
        if u.endswith("." + KINDS[kind]) or (kind == "en" and u.endswith(".gkg.csv.zip") and "translation" not in u):
            return u.rsplit("/", 1)[1].split(".")[0]
    return None


def collect(st: State) -> int:
    t0 = time.time()
    fips_names: dict = defaultdict(Counter)
    unknown: Counter = Counter()
    theme_seen: dict = {}
    todo = []
    for kind in KINDS:
        top = latest_listed(kind)
        if not top:
            continue
        t = st_dt(top)
        for i in range(BACK_DAYS * 96):
            s = (t - timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S")
            if s not in st.done[kind]:
                todo.append((s, kind))
    todo.sort(reverse=True)  # 새 파일 먼저, 남는 시간에 지난 파일
    got = miss = 0
    for s, kind in todo:
        if time.time() - t0 > BUDGET_S:
            break
        try:
            blob = get(f"{BASE}{s}.{KINDS[kind]}")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                miss += 1
                # 3시간 넘게 없는 파일은 GDELT 쪽 빈 칸으로 보고 다시 찾지 않는다
                if st_dt(s) < datetime.now(timezone.utc) - timedelta(hours=3):
                    st.done[kind].add(s)
                continue
            print(f"  ! {s} {kind}: {e}")
            continue
        except Exception as e:  # noqa: BLE001
            print(f"  ! {s} {kind}: {e.__class__.__name__}")
            continue
        n = process_ev(st, kind, s, blob) if kind in EV_KINDS else process(st, kind, s, blob, fips_names, unknown, theme_seen)
        got += 1
        if got <= 3 or got % 25 == 0:
            print(f"  {kind} {s}: 기사 {n}개 ({time.time() - t0:.0f}초)")
    trim_pp(st)
    left = len(todo) - got - miss
    print(f"처리 {got}개 · 아직 없음 {miss}개 · 남은 지난 파일 약 {max(left, 0)}개 · {time.time() - t0:.0f}초")
    check_fips(fips_names)
    if unknown:
        print("표에 없는 FIPS(기사 수, GDELT 이름):", [(f, n, (fips_names.get(f) or Counter()).most_common(1)) for f, n in unknown.most_common(25)])
    if theme_seen and "--themes" in sys.argv:
        for key, name, *_ in T.CATS:
            hits = [(t, c) for t, c in theme_seen.items() if (_theme_memo.get(t, 0) >> T.KEYS.index(key)) & 1]
            print(f"[주제] {name}:", sorted(hits, key=lambda x: -x[1])[:12])
    return got


def check_fips(fips_names: dict):
    """GDELT가 그 FIPS 코드에 붙인 나라 이름과 표의 영어 이름이 다르면 적는다."""
    bad = []
    for f, names in fips_names.items():
        iso = F2I.get(f)
        if not iso:
            continue
        top = names.most_common(1)[0][0] if names else ""
        if iso and top and top.lower() != ROWS[iso]["en"].lower():
            bad.append(f"{f}→{iso}({ROWS[iso]['en']}) GDELT:{top}")
    if bad:
        print("FIPS 이름 다름:", "; ".join(sorted(bad)[:60]))
    else:
        print(f"FIPS 검사: 나라 {len(fips_names)}곳 이름 일치")


def heat(n: float, ref: float, ratio: float | None, floor: int = 20) -> int:
    """세계 이슈 지도와 같은 식: 보도량 65% + 평소 대비 35%(√보도량으로 줄임).
    GDELT는 나라 간 기사 수 차이가 수천 배라, 보도량 몫은 문턱(floor)~최댓값을 로그 눈금으로 편다."""
    lo, hi = math.log1p(floor), math.log1p(max(ref, floor + 1))
    vol = max(0.0, min(1.0, (math.log1p(n) - lo) / (hi - lo)))
    surge = 0.5 if ratio is None else max(0.0, min(1.0, 0.5 + math.log2(max(ratio, 1e-6)) / 4))
    return round(100 * (0.65 * vol + 0.35 * surge * math.sqrt(vol)))


def build(st: State, out: Path):
    newest = st.newest
    if not newest or not st.hours:
        print("아직 자료 없음")
        return
    # 영어·번역 파일이 네 개씩 다 들어온 마지막 시간까지만 쓴다(덜 찬 시간이 끝에 붙으면 기사 수가 갑자기 줄어 보인다)
    cnt = Counter()
    for k in KINDS:
        for s_ in st.done[k]:
            cnt[(k, s_[:10])] += 1
    full = [h for h in sorted(st.hours) if cnt[("en", h)] >= 4 and cnt[("tr", h)] >= 4]
    now_h = full[-1] if full else max(st.hours)
    hk_end = datetime.strptime(now_h, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    win = [(hk_end - timedelta(hours=i)).strftime("%Y%m%d%H") for i in range(24)]
    win48 = [(hk_end - timedelta(hours=i)).strftime("%Y%m%d%H") for i in range(47, -1, -1)]
    today = hk_end.astimezone(KST).date().isoformat()
    complete = [d for d in sorted(st.dcov) if d < today and st.dcov[d].get("en", 0) >= 90 and st.dcov[d].get("tr", 0) >= 90][-7:]

    agg: dict[str, list] = {}
    for hk in win:
        for iso, v in st.hours.get(hk, {}).items():
            a = agg.setdefault(iso, [0] * VLEN)
            for i, x in enumerate(v):
                a[i] += x

    gday = {d: [sum(v[0] for v in st.days.get(d, {}).values()), sum(v[IINV] for v in st.days.get(d, {}).values())] for d in complete}
    # 날짜 묶음과 같은 잣대(나라별 건수의 합)로 비교한다
    g24 = [sum(a[0] for a in agg.values()), sum(a[IINV] for a in agg.values())]

    def base_of(iso: str, idx: int) -> float | None:
        """평소 몫(지난 완전한 날들의 전체 대비 비율 중앙값)을 지금 24시간 전체 기사 수에 곱한 '평소라면 기대되는 건수'."""
        if len(complete) < 3:
            return None
        k = 0 if idx == 0 else 1
        shares = [st.days.get(d, {}).get(iso, [0] * VLEN)[idx] / gday[d][k] for d in complete if gday[d][k]]
        return statistics.median(shares) * g24[k] if shares else None

    def tone_base(iso: str) -> float | None:
        if len(complete) < 3:
            return None
        n = sum(st.days.get(d, {}).get(iso, [0] * VLEN)[0] for d in complete)
        s = sum(st.days.get(d, {}).get(iso, [0] * VLEN)[1] for d in complete)
        return s / n if n >= 20 else None

    ref_g = max((a[0] for a in agg.values()), default=1)
    ref_i = max((a[IINV] for a in agg.values()), default=1)
    days7 = [(hk_end.astimezone(KST).date() - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    cs = {}
    for iso, a in agg.items():
        if iso not in ROWS:
            continue
        n, ni = a[0], a[IINV]
        b, bi = base_of(iso, 0), base_of(iso, IINV)
        r = round(n / b, 2) if b and b >= 5 else None
        ri = round(ni / bi, 2) if bi and bi >= 5 else None
        t = round(a[1] / n, 2) if n else None
        tb = tone_base(iso)
        cs[iso] = {
            "n": n, "b": None if b is None else round(b), "r": r, "g": heat(n, ref_g, r),
            "i": ni, "ib": None if bi is None else round(bi), "ir": ri, "gi": heat(ni, ref_i, ri, 10),
            "t": t, "dt": None if (t is None or tb is None) else round(t - tb, 2),
            "c": {k: a[2 + j] for j, k in enumerate(T.KEYS) if a[2 + j]},
            "h": [st.hours.get(h, {}).get(iso, [0] * VLEN)[0] for h in win48] if a[0] >= 20 else None,
            "hi": [st.hours.get(h, {}).get(iso, [0] * VLEN)[IINV] for h in win48] if a[IINV] >= 10 else None,
            "s": [st.days.get(d, {}).get(iso, [0] * VLEN)[0] for d in days7],
            "si": [st.days.get(d, {}).get(iso, [0] * VLEN)[IINV] for d in days7],
        }

    # 무슨 일: 사건 묶음별 24시간 기사 수와 평소 대비(전체 사건 중 몫의 중앙값 × 지금 24시간 전체)
    ecomp = [d for d in sorted(st.dcov) if d < today and all(st.dcov[d].get(k, 0) >= 90 for k in EV_KINDS)][-7:]
    eg24 = sum(st.egh.get(h, 0) for h in win)
    ev24: dict = defaultdict(Counter)
    for hk in win:
        for iso, x in st.eh.get(hk, {}).items():
            ev24[iso].update(x)
    for iso, c in cs.items():
        es = []
        for g, n in ev24.get(iso, {}).items():
            if n < 5:
                continue
            b = None
            if len(ecomp) >= 3 and eg24:
                shares = [st.ed.get(d, {}).get(iso, {}).get(g, 0) / st.egd[d] for d in ecomp if st.egd.get(d)]
                b = statistics.median(shares) * eg24 if shares else None
            es.append([g, n, None if b is None else round(n / max(b, 1), 1), None if b is None else round(b, 1)])
        # 기사 수가 많고 평소보다 늘어난 묶음을 앞에(배수는 0.5~5배로 눌러 반영)
        es.sort(key=lambda x: -x[1] * min(5, max(0.5, x[2] if x[2] is not None else 1)))
        if es:
            c["e"] = es[:5]

    def top(key, cond, n=80, rev=True):
        xs = [i for i, c in cs.items() if cond(c)]
        return sorted(xs, key=lambda i: (cs[i][key] if cs[i][key] is not None else -1e9), reverse=rev)[:n]

    rank = {
        "general": top("g", lambda c: c["n"] >= 20),
        "invest": top("gi", lambda c: c["i"] >= 10),
        "surge": top("r", lambda c: c["r"] is not None and c["r"] >= 1.6 and c["n"] >= 100, 20),
        "risk": top("dt", lambda c: c["dt"] is not None and c["i"] >= 50 and c["dt"] < 0, 20, rev=False),
    }
    gl = {"n": sum(st.ghours.get(h, [0])[0] for h in win)}
    gl["c"] = {k: sum((st.ghours.get(h) or [0] * (NCAT + 2))[1 + j] for h in win) for j, k in enumerate(T.KEYS)}
    gl["h"] = [h for h in win48]
    gl["hs"] = {k: [(st.ghours.get(h) or [0] * (NCAT + 2))[1 + j] for h in win48] for j, k in enumerate(T.KEYS)}
    gl["hn"] = [(st.ghours.get(h) or [0])[0] for h in win48]

    asof = (hk_end + timedelta(hours=1)).astimezone(KST)
    pulse = {
        "v": 1,
        "updated": datetime.now(KST).isoformat(timespec="minutes"),
        "asof": asof.isoformat(timespec="minutes"),
        "baseline_days": len(complete),
        "days": days7,
        "cats": T.NAMES, "general_cats": T.GENERAL, "invest_cats": T.INVEST,
        "evk": E.NAMES, "ev_days": len(ecomp),
        "global": gl, "rank": rank, "countries": cs,
        "meta": {iso: {"ko": r["ko"], "id": r["id"], "en": r["en"]} for iso, r in ROWS.items()},
        "source": {"name": "GDELT Project", "url": "https://www.gdeltproject.org/"},
    }
    (out / "pulse.json").write_text(json.dumps(pulse, ensure_ascii=False, separators=(",", ":")), "utf-8")

    # 나라 상세: 최근 25시간 인물·장소·출처, 최근 기사 주소
    det = {}
    exs = defaultdict(lambda: {"p": Counter(), "l": Counter(), "s": Counter()})
    for hk in win:
        for iso, ex in st.pp.get(hk, {}).items():
            for k in ("p", "l", "s"):
                exs[iso][k].update(ex.get(k, {}))
    cutoff = (hk_end - timedelta(hours=23)).strftime("%Y%m%d%H%M%S")
    for iso in cs:
        ex = exs.get(iso)
        links = [x for x in st.links.get(iso, []) if x[0] >= cutoff]
        seen, arts = set(), []
        for s, url, src, m, tone in reversed(links):
            if url in seen:
                continue
            seen.add(url)
            arts.append([st_dt(s).astimezone(KST).strftime("%m-%d %H:%M"), url, src,
                         [k for j, k in enumerate(T.KEYS) if (m >> j) & 1], tone])
            if len(arts) >= 8:
                break
        evl = {}
        # 예시 기사는 평소보다 1.5배 넘게 늘어난 묶음에만 단다(흔한 묶음의 예시는 엉뚱한 기사일 때가 많다)
        for g, _, r, _ in cs[iso].get("e", []):
            if r is not None and r < 1.5:
                continue
            xs = [x for x in st.el.get(iso, {}).get(g, []) if x[0] >= cutoff]
            if xs:
                url = max(xs, key=lambda x: x[2])[1]
                evl[g] = [url, urlparse(url).netloc.removeprefix("www.")]
        det[iso] = {
            "p": [x for x in ex["p"].most_common(12) if x[0].lower() not in NOT_PERSON][:6] if ex else [], "l": ex["l"].most_common(5) if ex else [],
            "src": ex["s"].most_common(5) if ex else [], "a": arts, "ev": evl,
        }
    # AI 요약 재료(briefin.json, 공개하지 않음): 순위·급증 나라마다 최근 시간부터 시간당 2개씩 제목 20개까지
    targets = list(dict.fromkeys(rank["general"][:30] + rank["surge"][:10] + rank["invest"][:10]))
    bin_ = {}
    for iso in targets:
        xs, seen = [], set()
        for hk in win:
            for t, _src in st.tt.get(hk, {}).get(iso, [])[:2]:
                k = t.lower()[:50]
                if k not in seen:
                    seen.add(k)
                    xs.append(t[:140])
        if len(xs) >= 5:
            c = cs[iso]
            bin_[iso] = {"ko": ROWS[iso]["ko"], "n": c["n"], "r": c["r"],
                         "e": [[E.NAMES[g], k] for g, k, *_ in c.get("e", [])[:3]], "t": xs[:20]}
    (out / "briefin.json").write_text(json.dumps({"asof": pulse["asof"], "countries": bin_}, ensure_ascii=False), "utf-8")
    for iso in list(st.links):
        st.links[iso] = [x for x in st.links[iso] if x[0] >= cutoff]
        if not st.links[iso]:
            del st.links[iso]
    (out / "detail.json").write_text(json.dumps({"asof": pulse["asof"], "countries": det}, ensure_ascii=False,
                                                separators=(",", ":")), "utf-8")
    print(f"pulse.json: 나라 {len(cs)}곳 · 기준 {pulse['asof']} · 평소 수준 계산일 {len(complete)}일 · 24시간 기사 {gl['n']}")
    print("일반 상위:", [(i, cs[i]["g"], cs[i]["n"]) for i in rank["general"][:15]])
    print("투자자 상위:", [(i, cs[i]["gi"], cs[i]["i"]) for i in rank["invest"][:15]])
    print("급증:", [(i, cs[i]["r"]) for i in rank["surge"][:10]], "· 논조 하락:", [(i, cs[i]["dt"]) for i in rank["risk"][:10]])
    print(f"사건 묶음: 평소 계산일 {len(ecomp)}일 · 24시간 뿌리 사건 기사 {eg24} · 묶음 있는 나라 {sum(1 for c in cs.values() if 'e' in c)}곳")
    print("무슨 일(상위 나라):", [(i, [(e[0], e[1], e[2]) for e in cs[i].get("e", [])[:3]]) for i in rank["general"][:8]])
    print("무슨 일(급증 나라):", [(i, [(e[0], e[1], e[2]) for e in cs[i].get("e", [])[:3]]) for i in rank["surge"][:8]])


def calendar(out: Path) -> bool:
    p = out / "calendar.json"
    if p.exists():
        try:
            old = json.loads(p.read_text("utf-8"))
            age = datetime.now(KST) - datetime.fromisoformat(old["updated"])
            if age < timedelta(hours=6):
                return False
        except Exception:  # noqa: BLE001
            pass
    import calendar_build as cb  # 세계 이슈 지도와 같은 공식 일정 수집기, 실적 일정은 뺀다
    cb.earnings = lambda *a, **k: []
    cal = cb.build()
    cal["items"] = [x for x in cal["items"] if x.get("cat") != "earn"]
    cal["note"] = "연준·BEA·Census·BLS·한국은행 공개 일정"
    p.write_text(json.dumps(cal, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"calendar.json: {len(cal['items'])}건")
    return True


def news(out: Path) -> bool:
    """위키백과 오늘·어제(UTC) 주요 사건을 news.json으로. 받지 못한 날은 지난 값을 그대로 둔다. 내용이 같으면 쓰지 않는다."""
    p = out / "news.json"
    try:
        old = json.loads(p.read_text("utf-8")) if p.exists() else {}
    except Exception:  # noqa: BLE001
        old = {}
    olds = {d["date"]: d for d in old.get("days", [])}
    m = W.Matcher(ROWS)
    now = datetime.now(timezone.utc).date()
    days = []
    for i in range(2):
        d = now - timedelta(days=i)
        try:
            raw = get(W.raw_url(d), 30).decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                print(f"  ! 위키백과 {d}: {e.code}")
            if d.isoformat() in olds:
                days.append(olds[d.isoformat()])
            continue
        except Exception as e:  # noqa: BLE001
            print(f"  ! 위키백과 {d}: {e.__class__.__name__}")
            if d.isoformat() in olds:
                days.append(olds[d.isoformat()])
            continue
        items = [{"cat": W.CATS.get(it["cat"], it["cat"]), "topic": it["topic"][-1] if it["topic"] else "", "text": it["text"],
                  "src": it["src"][:3], "c": m.find(it)} for it in W.parse(raw)]
        days.append({"date": d.isoformat(), "url": W.page_url(d), "items": items})
    if not days:
        return False
    data = {"updated": datetime.now(KST).isoformat(timespec="minutes"), "days": days,
            "source": {"name": "Wikipedia, Portal:Current events", "license": "CC BY-SA 4.0",
                       "license_url": "https://creativecommons.org/licenses/by-sa/4.0/"}}
    # 이미 옮겨 둔 한국어(translate.py가 쌓은 ko.json)를 붙인다
    kp = out / "ko.json"
    if kp.exists():
        try:
            TR.apply(data, json.loads(kp.read_text("utf-8")).get("t", {}))
        except Exception:  # noqa: BLE001
            pass
    if days == old.get("days"):
        return False
    p.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print("news.json:", ", ".join(f"{d['date']} {len(d['items'])}건" for d in days))
    return True


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    st = State(out / "state.json")
    got = collect(st)
    changed = got > 0
    if got or not (out / "pulse.json").exists():
        build(st, out)
    try:
        changed = calendar(out) or changed
    except Exception as e:  # noqa: BLE001
        print(f"  ! 경제 일정: {e.__class__.__name__}: {e}")
    try:
        changed = news(out) or changed
    except Exception as e:  # noqa: BLE001
        print(f"  ! 위키백과 사건: {e.__class__.__name__}: {e}")
    if changed:
        st.save()
        (out / ".changed").write_text("1")


if __name__ == "__main__":
    main()
