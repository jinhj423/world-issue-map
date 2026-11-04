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

ROOT = newsmap.ROOT
DATA = ROOT / "public" / "data"
UA = "Mozilla/5.0 (compatible; WorldIssueMap/1.0; +https://github.com/)"
LI_RE = re.compile(r"<li\b", re.I)


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
        k = max(1, len(LI_RE.findall(html.unescape(desc))))
        out.append({"t": newsmap.clean_title(title, source), "s": source, "u": link, "p": p, "k": k})
        if len(out) >= limit:
            break
    return out


def fetch_country(c: dict) -> tuple[str, dict]:
    time.sleep(random.uniform(0.3, 1.2))  # 예의상 간격
    res: dict = {"items": [], "local": []}
    body = get(search_url(c))
    if body:
        try:
            res["items"] = parse_rss(body)
        except ET.ParseError as e:
            print(f"  ! parse {c['a2']}: {e}", file=sys.stderr)
    lu = local_url(c)
    if lu:
        lb = get(lu)
        if lb:
            try:
                res["local"] = [{"t": i["t"], "s": i["s"], "u": i["u"], "p": i["p"]} for i in parse_rss(lb, 10)]
            except ET.ParseError:
                pass
    print(f"  {c['a2']} {c['ko']}: {len(res['items'])}건 / 현지 {len(res['local'])}건")
    return c["a2"], res


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
        with ThreadPoolExecutor(max_workers=4) as ex:
            raw = dict(ex.map(fetch_country, countries))

    hist_path = DATA / "history.json"
    history = json.loads(hist_path.read_text("utf-8")) if hist_path.exists() else {}
    ds = newsmap.build_dataset(raw, history, now, "Google News RSS (한국어판 + 현지판)")

    got = sum(1 for d in ds["countries"].values() if d["n"])
    if not args.dry and got < len(countries) * 0.3:
        # 차단·장애로 대부분 비었으면 기존 데이터를 덮어쓰지 않는다
        sys.exit(f"수집 실패가 많음({got}/{len(countries)}) — 기존 news.json 유지")

    DATA.mkdir(exist_ok=True)
    out = DATA / ("news.dry.json" if args.dry else "news.json")
    out.write_text(json.dumps(ds, ensure_ascii=False, separators=(",", ":")), "utf-8")
    if not args.dry:
        hist_path.write_text(json.dumps(newsmap.update_history(history, ds, now), ensure_ascii=False), "utf-8")
    print(f"완료: {got}/{len(countries)}개국 → {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
