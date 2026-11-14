"""
세계 이슈 지도 — 뉴스 수집기
GitHub Actions에서 매시간 실행 → data/news.json, data/history.json 갱신.

데이터: 구글 뉴스 RSS (API 키 불필요)
  · 국가별 한국어 헤드라인: news.google.com/rss/search?q=(intitle:일본 OR intitle:日) when:1d &hl=ko&gl=KR
  · 현지 1면 헤드라인:     news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja
실행: python scripts/fetch_news.py          (네트워크 필요)
     python scripts/fetch_news.py --dry    (tests/fixtures 의 RSS로 파싱만 확인)
"""
from __future__ import annotations

import argparse
import html
import json
import random
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import newsmap  # noqa: E402
import archive  # noqa: E402

ROOT = newsmap.ROOT
DATA = ROOT / "public" / "data"
UA = "Mozilla/5.0 (compatible; WorldIssueMap/1.0; +https://github.com/)"
LI_RE = re.compile(r"<li\b", re.I)
FONT_RE = re.compile(r"<font[^>]*>([^<]{1,60})</font>", re.I)


def search_url(c: dict) -> str:
    if not c["aliases"]:  # 대한민국: 국내 주요 뉴스 1면
        return "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko"
    q = " OR ".join(f"intitle:{a}" for a in c["aliases"])
    q = f"({q}) when:1d"
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"})


def local_url(c: dict) -> str | None:
    if not c.get("local") or c["a2"] == "KR":
        return None
    gl, lang = c["local"].split(":")
    return "https://news.google.com/rss?" + urllib.parse.urlencode(
        {"hl": lang, "gl": gl, "ceid": c["local"]})


def get(url: str, tries: int = 3) -> bytes | None:
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko,en;q=0.8"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print(f"  ! {e.__class__.__name__}: {url[:90]} (try {i + 1})", file=sys.stderr)
            time.sleep(2 * (i + 1) + random.random())
    return None


def parse_rss(xml_bytes: bytes, limit: int = 60) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        src_el = item.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        pub = item.findtext("pubDate")
        try:
            p = parsedate_to_datetime(pub).astimezone(newsmap.KST).isoformat(timespec="minutes") if pub else None
        except (TypeError, ValueError):
            p = None
        desc = item.findtext("description") or ""
        # 구글 뉴스는 같은 사건의 관련 기사들을 <ol><li>로 묶어 준다 → 군집 크기 = 사건의 크기
        d = html.unescape(desc)
        k = max(1, len(LI_RE.findall(d)))
        # 묶음 안 기사들의 언론사 이름 → 서로 다른 언론사 수(교차 확인)에 쓴다
        ss = sorted({x.strip() for x in FONT_RE.findall(d) if x.strip()} - {source})
        row = {"t": newsmap.clean_title(title, source), "s": source, "u": link, "p": p, "k": k}
        if ss:
            row["ss"] = ss
        out.append(row)
        if len(out) >= limit:
            break
    return out


def fetch_country(c: dict, do_local: bool = True) -> tuple[str, dict]:
    time.sleep(random.uniform(0.3, 1.2))  # 예의상 간격
    res: dict = {"items": [], "local": []}
    body = get(search_url(c))
    if body:
        try:
            res["items"] = parse_rss(body)
        except ET.ParseError as e:
            print(f"  ! parse {c['a2']}: {e}", file=sys.stderr)
    lu = local_url(c) if do_local else None
    if lu:
        lb = get(lu)
        if lb:
            try:
                res["local"] = [{"t": i["t"], "s": i["s"], "u": i["u"], "p": i["p"]} for i in parse_rss(lb, 10)]
            except ET.ParseError:
                pass
    print(f"  {c['a2']} {c['ko']}: {len(res['items'])}건 / 현지 {len(res['local'])}건")
    return c["a2"], res


GN = "https://news.google.com/rss"
KO = {"hl": "ko", "gl": "KR", "ceid": "KR:ko"}


def gsearch(q: str) -> str:
    return f"{GN}/search?" + urllib.parse.urlencode({"q": q, **KO})


# 나라 이름이 제목에 없는 큰 뉴스(경제·증시, 인물 화제)를 따로 모은다
TOPIC_FEEDS = {
    "econ": [
        f"{GN}/headlines/section/topic/BUSINESS?" + urllib.parse.urlencode(KO),
        gsearch("(증시 OR 코스피 OR 코스닥 OR 나스닥 OR 다우 OR S&P500 OR 환율 OR 금리 OR 국채) when:1d"),
        gsearch("(주가 OR 주식 OR 실적 OR 시가총액 OR 공모주 OR 상장 OR 반도체 OR 비트코인) when:1d"),
    ],
    "buzz": [
        f"{GN}?" + urllib.parse.urlencode(KO),
        f"{GN}/headlines/section/topic/TECHNOLOGY?" + urllib.parse.urlencode(KO),
        f"{GN}/headlines/section/topic/WORLD?" + urllib.parse.urlencode(KO),
        f"{GN}/headlines/section/topic/ENTERTAINMENT?" + urllib.parse.urlencode(KO),
    ],
}


def fetch_topics(now: datetime) -> dict:
    out = {}
    for name, urls in TOPIC_FEEDS.items():
        items: list[dict] = []
        for u in urls:
            body = get(u)
            if not body:
                continue
            try:
                rows = parse_rss(body, 80)
            except ET.ParseError:
                continue
            for i, r in enumerate(rows):  # 구글이 위에 둔 기사일수록 큰 뉴스
                r["pw"] = 1.5 if i < 10 else 1.2 if i < 25 else 1.0
            items += rows
        out[name] = newsmap.build_topic(items, now)
        print(f"  {name}: {len(items)}건 → {len(out[name]['items'])}개 사건")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="네트워크 없이 tests/fixtures RSS로 실행")
    args = ap.parse_args()

    countries = newsmap.load_countries()
    now = datetime.now(timezone.utc)
    if args.dry:
        fx = ROOT / "tests" / "fixtures"
        raw = {}
        for f in fx.glob("*.xml"):
            raw[f.stem.upper()] = {"items": parse_rss(f.read_bytes()), "local": []}
    else:
        # 10분 주기 중 매시 0~9분·30~39분 회차만 현지 1면을 새로 받는다(구글 요청 절반으로, 현지 1면은 천천히 바뀜)
        do_local = now.minute % 30 < 10   # 10분마다 실행, 현지판은 30분에 한 번
        prev_local = {}
        try:
            prev = json.loads((DATA / "news.json").read_text("utf-8"))
            prev_local = {a: c.get("local") or [] for a, c in prev.get("countries", {}).items()}
        except Exception:
            do_local = True
        with ThreadPoolExecutor(max_workers=4) as ex:
            raw = dict(ex.map(lambda c: fetch_country(c, do_local), countries))
        if not do_local:
            for a2, r in raw.items():
                r["local"] = prev_local.get(a2, [])
        print("현지 1면:", "새로 받음" if do_local else "직전 값 재사용")

    hist_path = DATA / "history.json"
    history = json.loads(hist_path.read_text("utf-8")) if hist_path.exists() else {}
    ds = newsmap.build_dataset(raw, history, now, "Google News RSS (한국어판 + 현지판)")
    if not args.dry:
        try:
            ds.update(fetch_topics(now))
        except Exception as e:  # noqa: BLE001 — 주제 묶음이 실패해도 나라 데이터는 올린다
            print("주제 묶음 실패:", e.__class__.__name__, file=sys.stderr)

    got = sum(1 for d in ds["countries"].values() if d["n"])
    if not args.dry and got < len(countries) * 0.3:
        # 차단·장애로 대부분 비었으면 기존 데이터를 덮어쓰지 않는다
        sys.exit(f"수집 실패가 많음({got}/{len(countries)}) — 기존 news.json 유지")

    DATA.mkdir(exist_ok=True)
    out = DATA / ("news.dry.json" if args.dry else "news.json")
    out.write_text(json.dumps(ds, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if not args.dry:
        hist_path.write_text(json.dumps(newsmap.update_history(history, ds, now), ensure_ascii=False), "utf-8")
        archive.update(DATA, ds, now)
    print(f"완료: {got}/{len(countries)}개국 → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
