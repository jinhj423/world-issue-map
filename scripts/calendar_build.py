"""경제 일정(calendar.json): 공식 기관 일정 + 대형주 실적 일정. AI 없이 규칙으로 만든다.

출처(2026-11-14 GitHub Actions에서 접속 확인):
  - 미 연준 FOMC 일정 페이지(federalreserve.gov/monetarypolicy/fomccalendars.htm) → 금리 결정(둘째 날 14:00 ET), 의사록(결정 + 3주)
  - 미 경제분석국 BEA 공개 일정 ICS(bea.gov/news/schedule/ics/...) → GDP, PCE 물가(개인소득·지출), 무역수지
  - 미 인구조사국 Census 경제지표 일정(census.gov/economic-indicators/calendar-listview.html) → 소매판매, 내구재 주문, 주택 착공, 신규 주택 판매
  - 미 노동통계국 BLS는 자동 접속을 막아(403) 공식 일정표에서 옮긴 날짜를 config/calendar_fixed.json에 둔다(CPI·고용·PPI) — 해가 바뀌면 갱신
  - 한국은행 금통위·연준 베이지북도 config/calendar_fixed.json
  - 실적: Nasdaq 실적 일정 API(api.nasdaq.com/api/calendar/earnings) 중 시가총액 1,500억 달러 이상(참고 일정)
시각은 모두 한국 시간으로 바꿔 쓴다(zoneinfo가 미국 서머타임을 계산). 모르는 시각은 "—".
"""
from __future__ import annotations

import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
ET, KST = ZoneInfo("America/New_York"), ZoneInfo("Asia/Seoul")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
MON3 = {k[:3]: v for k, v in MONTHS.items()}


def get(url: str, accept: str = "*/*") -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept, "Accept-Language": "en-US,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print(f"  ! {e.__class__.__name__}: {url[:80]}", file=sys.stderr)
        return None


def at_et(d: date, hh: int, mm: int) -> tuple[str, str]:
    k = datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).astimezone(KST)
    return k.date().isoformat(), k.strftime("%H:%M")


def item(day: str, time: str, country: str, cat: str, title: str, imp: int, src: str, **kw) -> dict:
    return {"date": day, "time": time, "country": country, "cat": cat, "title": title, "imp": imp, "src": src, **kw}


# ── 연준 FOMC ──
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"


def fomc(fixed: dict) -> list[dict]:
    out = []
    body = get(FOMC_URL)
    meetings: list[date] = []
    if body:
        for ym in re.finditer(r"(\d{4}) FOMC Meetings", body):
            year = int(ym.group(1))
            seg = body[ym.end(): body.find("FOMC Meetings", ym.end()) if body.find("FOMC Meetings", ym.end()) > 0 else len(body)]
            for m in re.finditer(r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<', seg, re.S):
                mon, days = m.group(1).strip().lower(), html.unescape(m.group(2)).strip()
                dd = re.findall(r"\d+", days)
                if not dd:
                    continue
                last_mon = mon.split("/")[-1][:3]
                if last_mon not in MON3:
                    continue
                try:
                    meetings.append(date(year, MON3[last_mon], int(dd[-1])))
                except ValueError:
                    pass
    if not meetings:  # 페이지 구조가 바뀌면 확인해 둔 날짜로
        meetings = [date.fromisoformat(x) for x in fixed.get("fomc", [])]
        print("  FOMC: 고정 목록 사용", file=sys.stderr)
    for d in sorted(set(meetings)):
        day, t = at_et(d, 14, 0)
        out.append(item(day, t, "US", "policy", "FOMC 금리 결정", 3, FOMC_URL))
        m = d + timedelta(days=21)
        day, t = at_et(m, 14, 0)
        out.append(item(day, t, "US", "policy", "FOMC 의사록 공개", 2, FOMC_URL))
    return out


# ── BEA ──
BEA_ICS = "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics"
BEA_MAP = [
    (r"^Gross Domestic Product.*Advance", "미국 GDP 속보치", 3),
    (r"^Gross Domestic Product", "미국 GDP", 2),
    (r"^Personal Income and Outlays", "미국 PCE 물가(개인소득·지출)", 3),
    (r"^U\.S\. International Trade in Goods and Services", "미국 무역수지", 1),
]


def bea() -> list[dict]:
    body = get(BEA_ICS)
    out = []
    if not body:
        return out
    body = re.sub(r"\r?\n[ \t]", "", body)  # ICS 줄 이어 붙이기
    for ev in body.split("BEGIN:VEVENT")[1:]:
        s = re.search(r"SUMMARY:(.+)", ev)
        t = re.search(r"DTSTART[^:]*:(\d{8}T\d{6}Z?)", ev)
        if not s or not t:
            continue
        summ = s.group(1).replace("\\,", ",").strip()
        raw = t.group(1)
        dt = datetime.strptime(raw.rstrip("Z"), "%Y%m%dT%H%M%S")
        dt = dt.replace(tzinfo=timezone.utc) if raw.endswith("Z") else dt.replace(tzinfo=ET)
        k = dt.astimezone(KST)
        for pat, title, imp in BEA_MAP:
            if re.search(pat, summ, re.I):
                period = summ.split(",", 1)[1].strip() if "," in summ else ""
                out.append(item(k.date().isoformat(), k.strftime("%H:%M"), "US", "econ", title, imp,
                                "https://www.bea.gov/news/schedule", period=period))
                break
    return out


# ── Census ──
CENSUS_URL = "https://www.census.gov/economic-indicators/calendar-listview.html"
CENSUS_MAP = [
    (r"Advance Monthly Sales for Retail", "미국 소매판매", 2),
    (r"Advance Report on Durable Goods", "미국 내구재 주문", 2),
    (r"New Residential Construction", "미국 주택 착공", 1),
    (r"New Residential Sales", "미국 신규 주택 판매", 1),
]


def census() -> list[dict]:
    body = get(CENSUS_URL)
    out = []
    if not body:
        return out
    text = html.unescape(re.sub(r"<[^>]+>", "\n", body))
    lines = [x.strip() for x in text.split("\n") if x.strip()]
    for i, ln in enumerate(lines):
        for pat, title, imp in CENSUS_MAP:
            if re.search(pat, ln, re.I):
                # 같은 줄이나 뒤 몇 줄에서 날짜·시각을 찾는다
                near = " ".join(lines[i:i + 6])
                dm = re.search(r"([A-Z][a-z]+)\.? (\d{1,2}),? (\d{4})", near)
                tm = re.search(r"(\d{1,2}):(\d{2}) ?([AP])\.?M", near, re.I)
                if not dm or dm.group(1).lower()[:3] not in MON3:
                    continue
                try:
                    d = date(int(dm.group(3)), MON3[dm.group(1).lower()[:3]], int(dm.group(2)))
                except ValueError:
                    continue
                if tm:
                    hh = int(tm.group(1)) % 12 + (12 if tm.group(3).upper() == "P" else 0)
                    day, t = at_et(d, hh, int(tm.group(2)))
                else:
                    day, t = d.isoformat(), "—"
                out.append(item(day, t, "US", "econ", title, imp, CENSUS_URL))
                break
    return out


# ── 고정 목록(BLS·한국은행·베이지북) ──
def fixed_items(fixed: dict) -> list[dict]:
    out = []
    for x in fixed.get("bls", []):
        d = date.fromisoformat(x["date"])
        hh, mm = map(int, x.get("et", "08:30").split(":"))
        day, t = at_et(d, hh, mm)
        out.append(item(day, t, "US", "econ", x["title"], x["imp"], x.get("src", "https://www.bls.gov/schedule/"), period=x.get("period", "")))
    for x in fixed.get("beige", []):
        day, t = at_et(date.fromisoformat(x), 14, 0)
        out.append(item(day, t, "US", "policy", "연준 베이지북", 2, "https://www.federalreserve.gov/monetarypolicy/beige-book-default.htm"))
    for x in fixed.get("bok", []):
        out.append(item(x["date"], x.get("time", "—"), "KR", "policy", "한국은행 금통위 기준금리 결정", 3,
                        "https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755"))
    return out


# ── 대형주 실적(Nasdaq) ──
NASDAQ = "https://api.nasdaq.com/api/calendar/earnings?date={}"
KO_NAME = {"DIS": "디즈니", "DE": "디어앤드컴퍼니", "ADI": "아날로그디바이시스", "CRWD": "크라우드스트라이크", "BHP": "BHP",
           "MDT": "메드트로닉", "ANET": "아리스타", "MRVL": "마벨", "LULU": "룰루레몬", "AVGO": "브로드컴","NVDA": "엔비디아", "AAPL": "애플", "MSFT": "마이크로소프트", "GOOGL": "알파벳(구글)", "GOOG": "알파벳(구글)",
           "AMZN": "아마존", "META": "메타", "TSLA": "테슬라", "AVGO": "브로드컴", "TSM": "TSMC", "WMT": "월마트",
           "JPM": "JP모건", "V": "비자", "MA": "마스터카드", "ORCL": "오라클", "COST": "코스트코", "NFLX": "넷플릭스",
           "AMD": "AMD", "MU": "마이크론", "HD": "홈디포", "BABA": "알리바바", "PDD": "PDD홀딩스", "CRM": "세일즈포스",
           "ADBE": "어도비", "INTU": "인튜이트", "LOW": "로우스", "TGT": "타깃", "PANW": "팔로알토", "SNOW": "스노우플레이크",
           "PLTR": "팔란티어", "QCOM": "퀄컴", "INTC": "인텔", "LLY": "일라이 릴리", "UNH": "유나이티드헬스", "XOM": "엑슨모빌",
           "BAC": "뱅크오브아메리카", "GS": "골드만삭스", "MS": "모건스탠리", "DELL": "델", "ASML": "ASML", "ARM": "Arm"}


def cap_num(s: str) -> float:
    try:
        return float(re.sub(r"[^\d.]", "", s or "") or 0)
    except ValueError:
        return 0.0


def earnings(start: date, days: int, min_cap: float = 150e9) -> list[dict]:
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        if d.weekday() >= 5:
            continue
        body = get(NASDAQ.format(d.isoformat()), "application/json")
        if not body:
            continue
        try:
            rows = ((json.loads(body).get("data") or {}).get("rows")) or []
        except json.JSONDecodeError:
            continue
        for r in rows:
            if cap_num(r.get("marketCap")) < min_cap:
                continue
            sym = r.get("symbol", "")
            when = r.get("time", "")
            if "after" in when:  # 장 마감 뒤 → 한국 다음 날 아침
                day, t, rel = (d + timedelta(days=1)).isoformat(), at_et(d, 16, 0)[1], "after"
            elif "pre" in when:  # 장 시작 전 → 한국 그날 밤
                day, t, rel = d.isoformat(), at_et(d, 9, 30)[1], "before"
            else:
                day, t, rel = d.isoformat(), "—", ""
            out.append(item(day, t, "US", "earn", f"{KO_NAME.get(sym, r.get('name', sym))} 실적", 3 if cap_num(r.get("marketCap")) >= 500e9 else 2,
                            "https://www.nasdaq.com/market-activity/earnings", sym=sym, rel=rel,
                            eps=r.get("epsForecast") or None))
    return out


def build(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(KST).date()
    fixed = json.loads((ROOT / "config" / "calendar_fixed.json").read_text("utf-8"))
    items: list[dict] = []
    for name, fn in (("fomc", lambda: fomc(fixed)), ("bea", bea), ("census", census), ("fixed", lambda: fixed_items(fixed)),
                     ("earn", lambda: earnings(today - timedelta(days=1), 22))):
        try:
            got = fn()
        except Exception as e:  # noqa: BLE001 — 한 출처가 실패해도 나머지는 올린다
            print(f"  ! {name}: {e.__class__.__name__}", file=sys.stderr)
            got = []
        print(f"  {name}: {len(got)}건")
        if "--debug" in sys.argv and name == "census":
            for x in got[:12]:
                print("    ", x["date"], x["time"], x["title"])
            body = get(CENSUS_URL) or ""
            i = body.find("Retail")
            print("    HTML:", re.sub(r"\s+", " ", body[max(0, i - 600): i + 900]))
        items += got
    lo, hi = (today - timedelta(days=2)).isoformat(), (today + timedelta(days=45)).isoformat()
    seen, rows = set(), []
    for x in sorted(items, key=lambda x: (x["date"], x["time"] if x["time"] != "—" else "99", -x["imp"])):
        k = (x["date"], x["title"])
        if lo <= x["date"] <= hi and k not in seen:
            seen.add(k)
            x["id"] = re.sub(r"[^0-9a-z]", "", (x["date"] + x.get("sym", "") + x["title"].encode("utf-8").hex()[:16]).lower())[:32]
            rows.append(x)
    return {"updated": now.astimezone(KST).isoformat(timespec="minutes"), "items": rows}


if __name__ == "__main__":
    out = build()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "calendar.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"완료: {len(out['items'])}건 → public/data/calendar.json")
    if "--print" in sys.argv:
        for x in out["items"][:60]:
            print(x["date"], x["time"], x["country"], x["cat"], x["imp"], x["title"], x.get("period", ""))
