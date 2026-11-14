"""GDELT DOC 2.0 API 시험 — 한국어 기사가 나라별로 얼마나 잡히는지 확인만 한다(사이트는 바꾸지 않음).

사용: python3 scripts/probe_gdelt.py /tmp/news.json
- 한국어 기사 전체 양(24시간·7일), 언론사 분포, 제목이 한글인지, 반영 지연
- 나라별 24시간 건수: 한국어 기사 / 전체 언어 / 지금 사이트(구글 뉴스) 집계
- 나라별 한국어 기사 제목에 그 나라 한국어 이름이 들어 있는 비율(정확도)
GDELT 요청 간격 권장값(5초)을 지키려고 6초씩 쉰다.
"""
import collections, datetime as dt, json, re, sys, time, urllib.parse, urllib.request

API = "https://api.gdeltproject.org/api/v2/doc/doc"
UA = "wnm-probe/1.0 (+https://github.com/jinhj423/world-issue-map)"
HANGUL = re.compile(r"[가-힣]")

# (a2, 영어 검색어, 한국어 이름·별칭)
TESTS = [
    ("US", '("United States" OR American)', ["미국", "美", "트럼프", "백악관", "워싱턴"]),
    ("CN", "China", ["중국", "中", "시진핑", "베이징"]),
    ("JP", "Japan", ["일본", "日", "도쿄", "다카이치"]),
    ("RU", "Russia", ["러시아", "露", "푸틴", "모스크바"]),
    ("UA", "Ukraine", ["우크라이나", "우크라", "젤렌스키", "키이우"]),
    ("IL", "Israel", ["이스라엘", "네타냐후", "가자"]),
    ("IR", "Iran", ["이란", "테헤란"]),
    ("KP", '"North Korea"', ["북한", "北", "김정은", "평양"]),
    ("IN", "India", ["인도", "모디", "뉴델리"]),
    ("DE", "Germany", ["독일", "베를린", "메르츠"]),
    ("TW", "Taiwan", ["대만", "타이완", "타이베이"]),
    ("GB", '("United Kingdom" OR Britain)', ["영국", "英", "런던"]),
    ("CU", "Cuba", ["쿠바", "아바나"]),
    ("VE", "Venezuela", ["베네수엘라", "마두로", "카라카스"]),
]

LAST = [0.0]


def call(query, mode, timespan, extra=None):
    wait = 6.2 - (time.time() - LAST[0])
    if wait > 0:
        time.sleep(wait)
    q = {"query": query, "mode": mode, "format": "json", "timespan": timespan}
    if extra:
        q.update(extra)
    url = API + "?" + urllib.parse.urlencode(q)
    for attempt in range(3):
        LAST[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            body = f"ERROR {e}"
        if body.startswith("{"):
            try:
                return json.loads(body)
            except ValueError:
                pass
        print(f"  ! {mode} {query[:40]} → {body[:120]!r}", flush=True)
        time.sleep(8)
    return None


def vol(query, timespan):
    d = call(query, "timelinevolraw", timespan)
    if not d or not d.get("timeline"):
        return None, None, []
    rows = d["timeline"][0].get("data", [])
    return sum(x.get("value", 0) for x in rows), sum(x.get("norm", 0) for x in rows), rows


def arts(query, timespan, n=250):
    d = call(query, "artlist", timespan, {"maxrecords": n, "sort": "datedesc"})
    return (d or {}).get("articles", []) if d is not None else None


def seen(a):
    try:
        return dt.datetime.strptime(a["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def main():
    news = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {"countries": {}}
    site = news.get("countries", {})
    now = dt.datetime.now(dt.timezone.utc)
    out = {"run_at": now.isoformat(), "site_updated_at": news.get("updated_at")}
    print("실행 시각(UTC)", now.isoformat(), "· 사이트 자료", news.get("updated_at"))

    # 1. 언어 필터 표기 확인
    for lang in ("sourcelang:korean", "sourcelang:kor"):
        v, norm, _ = vol(lang, "24h")
        print(f"[언어] {lang}: 24시간 {v}건 (같은 시간 전체 언어 {norm}건)")
        out.setdefault("lang", {})[lang] = [v, norm]
    LQ = "sourcelang:korean" if (out["lang"].get("sourcelang:korean") or [0])[0] else "sourcelang:kor"

    # 2. 7일 하루 단위
    v7, n7, rows = vol(LQ, "7d")
    per_day = collections.Counter()
    for x in rows:
        per_day[x["date"][:8]] += x.get("value", 0)
    print(f"[7일] 한국어 {v7}건 · 하루별", dict(sorted(per_day.items())))
    out["per_day"] = dict(per_day)

    # 3. 최근 한국어 기사 250개: 언론사·제목 언어·지연
    a = arts(LQ, "24h") or []
    doms = collections.Counter(x.get("domain") for x in a)
    hangul = sum(1 for x in a if HANGUL.search(x.get("title") or ""))
    ts = [t for t in (seen(x) for x in a) if t]
    lag = (now - max(ts)).total_seconds() / 60 if ts else None
    span = (max(ts) - min(ts)).total_seconds() / 3600 if ts else None
    print(f"[기사 표본] {len(a)}개 · 제목 한글 {hangul}개 · 가장 최근 기사까지 {lag and round(lag)}분 전 · 표본이 덮는 시간 {span and round(span,1)}시간")
    print("[언론사 상위 25]", doms.most_common(25))
    print("[언론사 수]", len(doms))
    for x in a[:12]:
        print("   ", x.get("seendate"), x.get("domain"), "|", (x.get("title") or "")[:70])
    out["sample"] = {"n": len(a), "hangul": hangul, "lag_min": lag, "span_h": span, "domains": doms.most_common(40)}

    # 4. 나라별
    print("\n[나라별 24시간] a2 | 한국어(GDELT) | 전체 언어(GDELT) | 사이트 w·n | 제목 정확도")
    rows_out = []
    for a2, q, ko in TESTS:
        kv, _, _ = vol(f"{q} {LQ}", "24h")
        av, _, _ = vol(q, "24h")
        sample = arts(f"{q} {LQ}", "24h", 75) or []
        hit = sum(1 for x in sample if any(k in (x.get("title") or "") for k in ko))
        s = site.get(a2) or {}
        r = {"a2": a2, "ko_gdelt": kv, "all_gdelt": av, "site_w": s.get("w"), "site_n": s.get("n"),
             "prec": f"{hit}/{len(sample)}",
             "examples": [(x.get("domain"), (x.get("title") or "")[:60]) for x in sample[:4]]}
        rows_out.append(r)
        print(f"  {a2} | {kv} | {av} | {s.get('w')}·{s.get('n')} | {hit}/{len(sample)}", flush=True)
        for d, t in r["examples"]:
            print(f"       - {d} | {t}")
    out["countries"] = rows_out

    # 5. 순위 비교
    def rank(key):
        xs = [r for r in rows_out if isinstance(r.get(key), (int, float))]
        return [r["a2"] for r in sorted(xs, key=lambda r: -r[key])]
    print("\n[순위] 한국어 GDELT:", rank("ko_gdelt"))
    print("[순위] 전체 언어 GDELT:", rank("all_gdelt"))
    print("[순위] 지금 사이트 w:", rank("site_w"))

    json.dump(out, open("/tmp/gdelt_probe.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
