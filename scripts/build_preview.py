"""index.html + 데이터 + 라이브러리를 한 파일로 묶어 미리보기(preview.html)를 만든다."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NM = ROOT / "build" / "node_modules"
html = (ROOT / "public" / "index.html").read_text("utf-8")
libs = {"d3": NM / "d3/dist/d3.min.js", "topojson": NM / "topojson-client/dist/topojson-client.min.js"}
for name, p in libs.items():
    html = re.sub(rf'<script src="[^"]+" data-inline="{name}"></script>',
                  lambda m: "<script>" + p.read_text("utf-8") + "</script>", html)
news = (ROOT / "public" / "data" / "news.json").read_text("utf-8")
world = (NM / "world-atlas/countries-110m.json").read_text("utf-8")
html = html.replace("<!--INLINE_DATA-->",
                    f"<script>window.__NEWS__={news};window.__WORLD__={world};</script>")
assert "data-inline" not in html
out = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "preview.html")
out.write_text(html, "utf-8")
print(out, f"{out.stat().st_size/1024:.0f} KB")
