"""텔레그램 채널 자동 게시 — 하루 2번(한국 시간 08시대·20시대), 규칙 기반이라 AI 토큰 0.

GitHub Actions 비밀값 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID가 있을 때만 보낸다(없으면 조용히 끝).
같은 시간대에 두 번 보내지 않도록 archive.json의 "tg"에 마지막으로 보낸 칸을 남긴다.
"""
import html
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import newsmap  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "public" / "data"
SLOTS = {8: "아침", 20: "저녁"}
SITE = os.environ.get("SITE_URL", "https://wnm.jinhj423-42b.workers.dev").rstrip("/")


def main() -> None:
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        print("텔레그램 비밀값 없음 — 건너뜀")
        return
    now = datetime.now(timezone.utc).astimezone(newsmap.KST)
    force = "--force" in sys.argv
    if now.hour not in SLOTS and not force:
        print("게시 시간대 아님")
        return
    slot = f"{now:%Y-%m-%d}-{now.hour:02d}"
    arc_path = DATA / "archive.json"
    arc = json.loads(arc_path.read_text("utf-8")) if arc_path.exists() else {}
    if arc.get("tg") == slot and not force:
        print("이미 보냄:", slot)
        return

    ds = json.loads((DATA / "news.json").read_text("utf-8"))
    C = ds["countries"]
    lines = [f"<b>{now.month}월 {now.day}일 {SLOTS.get(now.hour, '지금')}, 세계에서 가장 시끄러운 나라</b>", ""]
    used = set()
    for i, a2 in enumerate(ds["ranking"][:5], 1):
        c = C[a2]
        it = next((x for x in c.get("items", []) if x.get("u") not in used), None)
        if not it:
            continue
        used.add(it["u"])
        extra = f", 언론 {it['sc']}곳" if (it.get("sc") or 0) >= 2 else ""
        lines.append(f"{i}. <b>{html.escape(c['ko'])}</b>: <a href=\"{html.escape(it['u'])}\">{html.escape(it['t'])}</a> ({html.escape(it.get('s') or '')}{extra})")
    lines += ["", f"지도로 보기: {SITE}/"]
    body = urllib.parse.urlencode({
        "chat_id": chat, "text": "\n".join(lines), "parse_mode": "HTML", "disable_web_page_preview": "true",
    }).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            ok = json.loads(r.read()).get("ok")
    except Exception as e:  # 토큰 값이 로그에 남지 않게 종류만 적는다
        print("텔레그램 전송 실패:", type(e).__name__)
        return
    print("텔레그램 전송:", "성공" if ok else "실패")
    if ok:
        arc["tg"] = slot
        arc_path.write_text(json.dumps(arc, ensure_ascii=False, separators=(",", ":")), "utf-8")


if __name__ == "__main__":
    main()
