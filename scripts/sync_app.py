"""index.html을 수정하면 이 스크립트로 app/ 사본을 다시 생성한다.
app/ = 같은 사이트의 두 번째 입구(새 설치 경로). 데이터는 ../data를 공유한다."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
app = ROOT/"app"; app.mkdir(exist_ok=True)
s = (ROOT/"index.html").read_text()
s = s.replace('href="manifest.webmanifest?v=3"','href="manifest.webmanifest"')
s = s.replace('"data/news.json"','"../data/news.json"')
s = s.replace('href="icons/apple-touch-icon.png"','href="../icons/apple-touch-icon.png"')
(app/"index.html").write_text(s)
m = json.loads((ROOT/"manifest.webmanifest").read_text())
for ic in m["icons"]: ic["src"] = "../"+ic["src"]
(app/"manifest.webmanifest").write_text(json.dumps(m,ensure_ascii=False,indent=2))
sw = (ROOT/"sw.js").read_text()
sw = sw.replace('const V = "wim-v2";','const V = "wim-app-v1";')
sw = sw.replace('const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];',
                'const SHELL = ["./", "index.html", "manifest.webmanifest", "../icons/icon-192.png", "../icons/icon-512.png"];')
(app/"sw.js").write_text(sw)
print("app/ generated")
