"""
미리보기용: seed/*.json(수동 수집 헤드라인) → data/news.json
수집기와 같은 newsmap 로직(분류·군집·키워드·이슈 지수)을 그대로 쓴다.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import newsmap  # noqa: E402

ROOT = newsmap.ROOT
raw: dict = {}
for f in sorted((ROOT / "seed").glob("seed_*.json")):
    for a2, v in json.loads(f.read_text("utf-8"))["countries"].items():
        items = raw.setdefault(a2, {"items": [], "local": []})["items"]
        for it in v.get("items", []):
            items.append({"t": it["title"], "o": it.get("title_orig"), "s": it.get("source") or "",
                          "u": it["url"], "p": it.get("published"), "k": 1})

now = datetime(2026, 11, 3, 23, 30, tzinfo=newsmap.KST)
ds = newsmap.build_dataset(raw, {}, now, "2026년 11월 3일 웹 검색으로 모은 실제 기사 헤드라인(미리보기)",
                           filter_mentions=False)
ds["preview"] = True
out = ROOT / "public" / "data" / "news.json"
out.write_text(json.dumps(ds, ensure_ascii=False, separators=(",", ":")), "utf-8")
print("countries with items:", sum(1 for d in ds["countries"].values() if d["n"]), "/", len(ds["countries"]))
for a2 in ds["ranking"][:12]:
    d = ds["countries"][a2]
    print(f"{a2} {d['ko']:<8} heat={d['heat']:>3} n={d['n']} cat={d['cat']} kw={d['kw'][:4]}")
print("global:", [(g["kw"], len(g["countries"])) for g in ds["global_keywords"]])
