"""지난 기록: 날짜별 상위 나라·경제·화제·단어 수(archive.json)와 주간 정리(weeks.json).

- archive.json  {"days": {YYYY-MM-DD: {...}}, "live": 최근 7일 정리, "tg": 텔레그램 마지막 칸}
  날마다 그날 마지막 수집 값으로 덮어쓴다(8일 보관).
- weeks.json    {"weeks": {YYYY-Www: 정리}} 끝난 주(월~일)를 한 번 얼려 남긴다(26주 보관).
화면: 7일 탭, 단어 7일 추이, /weekly/ 페이지. 데이터 출처는 모두 수집한 Google News RSS 헤드라인.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

import newsmap

KW_KEEP = 300  # 날마다 남길 단어 수(많이 나온 순)


def _item(it: dict) -> dict:
    return {k: it.get(k) for k in ("t", "s", "u", "sc", "p") if it.get(k) is not None}


def day_record(ds: dict) -> dict:
    C = ds["countries"]
    top = []
    for a2 in ds["ranking"][:5]:
        c = C[a2]
        it = (c.get("items") or [{}])[0]
        top.append({"a2": a2, "ko": c.get("ko"), "heat": c.get("heat"), "n": c.get("n"), "cat": c.get("cat"), **_item(it)})
    # 단어 수: 그 단어가 들어간 헤드라인 수(나라·경제·화제 전체, 같은 기사는 한 번)
    titles, seen = [], set()
    for c in C.values():
        for it in c.get("items") or []:
            if it.get("u") not in seen:
                seen.add(it.get("u"))
                titles.append(it["t"])
    for k in ("econ", "buzz"):
        for it in (ds.get(k) or {}).get("items") or []:
            if it.get("u") not in seen:
                seen.add(it.get("u"))
                titles.append(it["t"])
    df: dict[str, int] = {}
    for t in titles:
        for tok in set(newsmap.tokens(t)):
            df[tok] = df.get(tok, 0) + 1
    kw = dict(sorted(df.items(), key=lambda x: -x[1])[:KW_KEEP])
    return {
        "at": ds["updated_at"], "top": top, "kw": kw,
        "econ": [_item(x) for x in ((ds.get("econ") or {}).get("items") or [])[:5]],
        "buzz": [_item(x) for x in ((ds.get("buzz") or {}).get("items") or [])[:5]],
    }


def _same(a: str, b: str) -> bool:
    x, y = set(newsmap.tokens(a)), set(newsmap.tokens(b))
    n = len(x & y)
    return n >= 4 or (n / (len(x | y) or 1)) >= 0.4


def summarize(days: dict, keys: list[str], wid: str | None = None, names: dict | None = None) -> dict:
    """keys(날짜 목록)의 기록으로 한 주 정리를 만든다."""
    keys = [k for k in keys if k in days]
    out = {"id": wid, "from": keys[0] if keys else None, "to": keys[-1] if keys else None, "days": []}
    agg: dict[str, dict] = {}
    for k in keys:
        rec = days[k]
        out["days"].append({"day": k, "top": [{**x, "ko": x.get("ko") or (names or {}).get(x["a2"])} for x in rec.get("top", [])[:3]]})
        for i, x in enumerate(rec.get("top", [])):
            a = agg.setdefault(x["a2"], {"a2": x["a2"], "ko": x.get("ko") or (names or {}).get(x["a2"]), "days": 0, "heat": 0, "best": 9, "first": []})
            a["days"] += 1
            a["heat"] += x.get("heat") or 0
            a["best"] = min(a["best"], i + 1)
            if i == 0:
                a["first"].append(k)
            a["ko"] = a["ko"] or x.get("ko")
    countries = sorted(agg.values(), key=lambda a: (-a["days"], a["best"], -a["heat"]))[:10]
    for a in countries:
        a["avg"] = round(a["heat"] / a["days"]) if a["days"] else 0
        a["first"] = len(a["first"])
        a.pop("heat", None)
    out["countries"] = countries
    # 단어: 기간 합계 상위, 날짜별 추이 함께
    drop = newsmap.GLOBAL_GENERIC | newsmap.TOPIC_STOP
    tot: dict[str, int] = {}
    for k in keys:
        for w, n in (days[k].get("kw") or {}).items():
            if w not in drop and len(w) >= 2:
                tot[w] = tot.get(w, 0) + n
    words = sorted(tot.items(), key=lambda x: -x[1])[:15]
    out["words"] = [{"w": w, "n": n, "trend": [(days[k].get("kw") or {}).get(w, 0) for k in keys]} for w, n in words]
    # 경제·화제: 기간 중 많이 다뤄진 소식(같은 이야기는 하나로)
    for key, lim in (("econ", 8), ("buzz", 6)):
        pool = []
        for k in keys:
            for it in days[k].get(key) or []:
                pool.append({**it, "day": k})
        pool.sort(key=lambda x: (-(x.get("sc") or 1), x.get("day", "")))
        picked: list[dict] = []
        for it in pool:
            if not any(_same(it.get("t", ""), p.get("t", "")) for p in picked):
                picked.append(it)
            if len(picked) >= lim:
                break
        out[key] = picked
    return out


def iso_week(d: str) -> str:
    y, w, _ = date.fromisoformat(d).isocalendar()
    return f"{y}-W{w:02d}"


def update(data_dir: Path, ds: dict, now: datetime) -> None:
    path = data_dir / "archive.json"
    try:
        arc = json.loads(path.read_text("utf-8"))
    except Exception:
        arc = {}
    days = arc.get("days", {})
    today = now.astimezone(newsmap.KST).strftime("%Y-%m-%d")
    days[today] = day_record(ds)
    keep = sorted(days)[-8:]
    days = {d: days[d] for d in keep}
    arc["days"] = days
    last7 = sorted(days)[-7:]
    names = {a2: c.get("ko") for a2, c in ds["countries"].items()}
    arc["live"] = summarize(days, last7, names=names)
    path.write_text(json.dumps(arc, ensure_ascii=False, separators=(",", ":")), "utf-8")

    # 끝난 주 얼리기: 이번 주보다 앞선 주이고 아직 없으면
    wpath = data_dir / "weeks.json"
    try:
        wk = json.loads(wpath.read_text("utf-8"))
    except Exception:
        wk = {"weeks": {}}
    cur = iso_week(today)
    by_week: dict[str, list[str]] = {}
    for d in sorted(days):
        by_week.setdefault(iso_week(d), []).append(d)
    changed = False
    for wid, ks in by_week.items():
        if wid < cur and wid not in wk["weeks"] and len(ks) >= 5:  # 기록이 5일 이상인 주만
            wk["weeks"][wid] = summarize(days, ks, wid, names)
            changed = True
    if changed or not wpath.exists():
        ids = sorted(wk["weeks"])[-26:]
        wk["weeks"] = {i: wk["weeks"][i] for i in ids}
        wpath.write_text(json.dumps(wk, ensure_ascii=False, separators=(",", ":")), "utf-8")


def week_range(wid: str) -> tuple[str, str]:
    y, w = wid.split("-W")
    mon = date.fromisocalendar(int(y), int(w), 1)
    return mon.isoformat(), (mon + timedelta(days=6)).isoformat()
