"""GDELT 시험 v3 — 새 영리용 사이트 설계용 원자료 조사(사이트는 바꾸지 않음).

- 영어 GKG 최근 8개 파일(2시간): 파일 크기·행 수·처리 시간, 나라 코드(FIPS)별 기사 수,
  나라 단위 장소 이름(FIPS 검증용), 주제(V1Themes) 상위 400, 인물 상위 60, 논조 분포, 제목 비율
- 번역 GKG 최근 8개 파일: 나라 코드별 기사 수
- 최신 파일 지연(목록에 있는 파일이 실제로 받아지는지)
- 정책브리핑 RSS 주소·형식, 보도자료 페이지의 공공누리 표시
결과: /tmp/probe3.json (아티팩트)
"""
import collections, csv, datetime as dt, io, json, re, statistics, sys, time, urllib.request, zipfile

csv.field_size_limit(1 << 30)
UA = "wnm-probe/1.0 (+https://github.com/jinhj423/world-issue-map)"
BASE = "http://data.gdeltproject.org/gdeltv2/"


def get(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def stamps(latest, n):
    t = dt.datetime.strptime(latest, "%Y%m%d%H%M%S")
    return [(t - dt.timedelta(minutes=15 * i)).strftime("%Y%m%d%H%M%S") for i in range(n)]


def rows_of(blob):
    z = zipfile.ZipFile(io.BytesIO(blob))
    with z.open(z.namelist()[0]) as f:
        for row in csv.reader(io.TextIOWrapper(f, "utf-8", errors="replace"), delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) >= 27:
                yield row


def scan(kind, suffix, n=8, deep=False):
    lu = get(BASE + ("lastupdate-translation.txt" if kind == "tr" else "lastupdate.txt")).decode().split()
    gk = [u for u in lu if u.endswith(suffix)][0]
    latest = gk.rsplit("/", 1)[1].split(".")[0]
    now = dt.datetime.utcnow()
    print(f"[{kind}] 목록의 최신 파일 {latest} · 지금보다 {round((now - dt.datetime.strptime(latest, '%Y%m%d%H%M%S')).total_seconds()/60)}분 전")
    cc = collections.Counter()
    names = collections.defaultdict(collections.Counter)
    themes = collections.Counter()
    persons = collections.Counter()
    tones = []
    titled = total = 0
    files = []
    for s in stamps(latest, n + 4):
        if len([f for f in files if f[1] != "ERR"]) >= n:
            break
        t0 = time.time()
        try:
            blob = get(f"{BASE}{s}.{suffix}")
        except Exception as e:  # noqa: BLE001
            files.append((s[8:12], "ERR", str(e)[:40]))
            continue
        k = 0
        for row in rows_of(blob):
            k += 1
            seen = set()
            for part in (row[9] or "").split(";"):
                f = part.split("#")
                if len(f) > 2 and f[2]:
                    seen.add(f[2])
                    if deep and f[0] == "1":
                        names[f[2]][f[1]] += 1
            for c in seen:
                cc[c] += 1
            if deep:
                for th in set((row[7] or "").split(";")):
                    if th:
                        themes[th] += 1
                for p in set((row[11] or "").split(";")):
                    if p:
                        persons[p] += 1
                try:
                    tones.append(float((row[15] or "0").split(",")[0]))
                except ValueError:
                    pass
                if "<PAGE_TITLE>" in (row[26] or ""):
                    titled += 1
        total += k
        files.append((s[8:12], k, round(len(blob) / 1e6, 2), round(time.time() - t0, 1)))
    print(f"[{kind}] 파일(UTC 시각, 행, MB, 초):", files)
    out = {"files": files, "total": total, "cc": cc.most_common()}
    if deep:
        out["names"] = {c: n.most_common(3) for c, n in names.items()}
        out["themes"] = themes.most_common(400)
        out["persons"] = persons.most_common(60)
        out["tone"] = {"n": len(tones), "mean": round(statistics.mean(tones), 2) if tones else None,
                       "p10": round(sorted(tones)[len(tones) // 10], 2) if tones else None,
                       "p90": round(sorted(tones)[len(tones) * 9 // 10], 2) if tones else None}
        out["titled"] = titled
        print(f"[{kind}] 기사 {total}개 · 제목 있음 {titled} · 논조", out["tone"])
        print(f"[{kind}] 주제 상위 60", themes.most_common(60))
        print(f"[{kind}] 인물 상위 30", persons.most_common(30))
    print(f"[{kind}] 나라 코드 수 {len(cc)} · 상위 40", cc.most_common(40))
    return out


def korea_kr():
    res = {}
    for url in ["https://www.korea.kr/etc/rss.do", "https://www.korea.kr/rss/pressrelease.xml",
                "https://www.korea.kr/rss/policy.xml", "https://www.korea.kr/rss/dept_mofa.xml"]:
        try:
            b = get(url, 30).decode("utf-8", "replace")
            links = sorted(set(re.findall(r"https?://www\.korea\.kr/rss/[A-Za-z0-9_./-]+\.xml", b)))
            items = re.findall(r"<item>(.*?)</item>", b, re.S)[:4]
            res[url] = {"len": len(b), "links": links[:80], "items": [re.sub(r"\s+", " ", i)[:500] for i in items]}
            print("[정책브리핑]", url, "길이", len(b), "· rss 주소", len(links), "· item", len(items))
            for i in items[:3]:
                print("    ", re.sub(r"\s+", " ", i)[:300])
        except Exception as e:  # noqa: BLE001
            res[url] = {"err": str(e)[:80]}
            print("[정책브리핑]", url, "ERR", e)
    # 보도자료 한 건 열어 공공누리 표시 확인
    for v in res.values():
        for i in v.get("items", []):
            m = re.search(r"<link>(.*?)</link>", i)
            if m:
                link = m.group(1).replace("&amp;", "&").strip()
                try:
                    page = get(link, 30).decode("utf-8", "replace")
                    kogl = [k for k in ("공공누리", "제1유형", "출처표시", "kogl") if k in page]
                    print("[보도자료 페이지]", link, "· 표시:", kogl)
                    res["page_check"] = {"link": link, "kogl": kogl}
                except Exception as e:  # noqa: BLE001
                    print("[보도자료 페이지] ERR", e)
                return res
    return res


def main():
    out = {"run_at": dt.datetime.utcnow().isoformat()}
    out["en"] = scan("en", "gkg.csv.zip", 8, deep=True)
    out["tr"] = scan("tr", "translation.gkg.csv.zip", 8)
    out["kr"] = korea_kr()
    json.dump(out, open("/tmp/probe3.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
