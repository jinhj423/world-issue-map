"""GDELT 시험 v2 — API가 GitHub 서버에서 429(요청 과다)로 막혀, 15분마다 올라오는 원자료 파일(GKG)로 본다.

사용: python3 scripts/probe_gdelt.py /tmp/news.json
- 번역 묶음(translation GKG, 영어 외 65개 언어) 최근 3시간(15분 파일 12개)에서 한국어(srclc:kor) 기사만 골라
  기사 수, 언론사 분포, 제목 한글 여부, 반영 지연, 나라별 건수(본문에 나온 장소의 나라), 제목 정확도를 센다.
- 영어 묶음 최근 1시간(파일 4개)으로 전 세계 영어 기사 나라별 건수도 센다(순위 비교용).
- 지금 사이트(구글 뉴스) 집계와 나란히 놓는다.
- API는 처음에 한 번만 다시 시험한다.
"""
import collections, csv, datetime as dt, io, json, re, sys, time, urllib.request, zipfile

csv.field_size_limit(1 << 30)
UA = "wnm-probe/1.0 (+https://github.com/jinhj423/world-issue-map)"
BASE = "http://data.gdeltproject.org/gdeltv2/"
HANGUL = re.compile(r"[가-힣]")
TITLE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.S)

# GDELT 장소 나라 코드(FIPS) → (ISO a2, 한국어 이름·별칭)
FIPS = {
    "US": ("US", ["미국", "美", "트럼프", "백악관", "워싱턴"]),
    "CH": ("CN", ["중국", "中", "시진핑", "베이징"]),
    "JA": ("JP", ["일본", "日", "도쿄", "다카이치"]),
    "RS": ("RU", ["러시아", "露", "푸틴", "모스크바"]),
    "UP": ("UA", ["우크라이나", "우크라", "젤렌스키", "키이우"]),
    "IS": ("IL", ["이스라엘", "네타냐후", "가자"]),
    "IR": ("IR", ["이란", "테헤란"]),
    "KN": ("KP", ["북한", "北", "김정은", "평양"]),
    "KS": ("KR", ["한국", "韓", "대한민국", "서울"]),
    "IN": ("IN", ["인도", "모디", "뉴델리"]),
    "GM": ("DE", ["독일", "베를린", "메르츠"]),
    "TW": ("TW", ["대만", "타이완", "타이베이"]),
    "UK": ("GB", ["영국", "英", "런던"]),
    "CU": ("CU", ["쿠바", "아바나"]),
    "VE": ("VE", ["베네수엘라", "마두로", "카라카스"]),
    "FR": ("FR", ["프랑스", "파리", "마크롱"]),
    "VM": ("VN", ["베트남", "하노이"]),
}


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def api_once():
    url = ("https://api.gdeltproject.org/api/v2/doc/doc?query=sourcelang:korean"
           "&mode=artlist&format=json&maxrecords=10&timespan=24h&sort=datedesc")
    try:
        b = get(url, 60).decode("utf-8", "replace")
        return "ok " + b[:160].replace("\n", " ")
    except Exception as e:  # noqa: BLE001
        return f"ERROR {e}"


def stamps(latest, n):
    t = dt.datetime.strptime(latest, "%Y%m%d%H%M%S")
    return [(t - dt.timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(n)]


def rows_of(url):
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    with z.open(z.namelist()[0]) as f:
        for row in csv.reader(io.TextIOWrapper(f, "utf-8", errors="replace"), delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) >= 27:
                yield row


def countries_of(row):
    out = set()
    for part in (row[9] or "").split(";"):
        f = part.split("#")
        if len(f) > 2 and f[2]:
            out.add(f[2])
    return out


def main():
    news = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {"countries": {}}
    site = news.get("countries", {})
    now = dt.datetime.now(dt.timezone.utc)
    print("실행 시각(UTC)", now.isoformat(), "· 사이트 자료", news.get("updated_at"))
    print("[API 한 번 더 시험]", api_once())

    # 번역 묶음
    lu = get(BASE + "lastupdate-translation.txt").decode().split()
    gk = [u for u in lu if u.endswith(".translation.gkg.csv.zip")][0]
    latest = gk.rsplit("/", 1)[1].split(".")[0]
    print("[최신 번역 파일]", gk, "· 지금보다", round((now.replace(tzinfo=None) - dt.datetime.strptime(latest, "%Y%m%d%H%M%S")).total_seconds() / 60), "분 전")

    tot_all = tot_ko = 0
    per_file = []
    src = collections.Counter()
    langs = collections.Counter()
    cc = collections.Counter()
    hangul = 0
    titles = collections.defaultdict(list)
    prec = collections.Counter()
    for s in stamps(latest, 12):
        url = f"{BASE}{s}.translation.gkg.csv.zip"
        try:
            n_all = n_ko = 0
            for row in rows_of(url):
                n_all += 1
                ti = row[25] or ""
                m = re.search(r"srclc:(\w+)", ti)
                lang = m.group(1) if m else "?"
                langs[lang] += 1
                if lang != "kor":
                    continue
                n_ko += 1
                src[row[3]] += 1
                tm = TITLE.search(row[26] or "")
                title = (tm.group(1).strip() if tm else "")
                if HANGUL.search(title):
                    hangul += 1
                for c in countries_of(row):
                    cc[c] += 1
                    if c in FIPS:
                        if any(k in title for k in FIPS[c][1]):
                            prec[c] += 1
                        if len(titles[c]) < 4:
                            titles[c].append((row[3], title[:60]))
            per_file.append((s[8:12], n_all, n_ko))
            tot_all += n_all
            tot_ko += n_ko
        except Exception as e:  # noqa: BLE001
            per_file.append((s[8:12], "ERR", str(e)[:60]))
    print("[15분 파일별 (UTC 시각, 번역 기사 전체, 한국어)]", per_file)
    print(f"[3시간 합계] 번역 기사 {tot_all}개 중 한국어 {tot_ko}개 · 제목 한글 {hangul}개")
    print("[언어 상위 15]", langs.most_common(15))
    print("[한국어 언론사 수]", len(src), "· 상위 30", src.most_common(30))

    # 영어 묶음(1시간)
    lu2 = get(BASE + "lastupdate.txt").decode().split()
    gk2 = [u for u in lu2 if u.endswith(".gkg.csv.zip")][0]
    latest2 = gk2.rsplit("/", 1)[1].split(".")[0]
    en = collections.Counter()
    en_tot = 0
    for s in stamps(latest2, 4):
        try:
            for row in rows_of(f"{BASE}{s}.gkg.csv.zip"):
                en_tot += 1
                for c in countries_of(row):
                    en[c] += 1
        except Exception as e:  # noqa: BLE001
            print("  ! 영어 파일", s, e)
    print(f"[영어 1시간] 기사 {en_tot}개")

    print("\n[나라별] 나라 | 한국어 3시간(GDELT) | 그중 제목에 나라 이름 | 영어 1시간(GDELT) | 지금 사이트 w·n")
    out = []
    for f, (a2, _) in FIPS.items():
        s = site.get(a2) or {}
        r = {"a2": a2, "ko3h": cc[f], "prec": prec[f], "en1h": en[f], "site_w": s.get("w"), "site_n": s.get("n")}
        out.append(r)
        print(f"  {a2} | {cc[f]} | {prec[f]} | {en[f]} | {s.get('w')}·{s.get('n')}")
        for d, t in titles[f]:
            print(f"       - {d} | {t}")

    def rank(k):
        return [r["a2"] for r in sorted([r for r in out if isinstance(r[k], (int, float))], key=lambda r: -r[k])]
    print("\n[순위] 한국어 GDELT:", rank("ko3h"))
    print("[순위] 영어 GDELT:", rank("en1h"))
    print("[순위] 지금 사이트 w:", rank("site_w"))
    print("[한국어 기사에 나온 나라 상위 25]", cc.most_common(25))
    json.dump({"per_file": per_file, "src": src.most_common(80), "cc": cc.most_common(80), "rows": out},
              open("/tmp/gdelt_probe.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
