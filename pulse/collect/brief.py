"""나라별 'AI 요약' — 그 나라를 다룬 기사 제목 표본을 Claude가 읽고, 지금 무엇이 보도되는지 우리 말로 새로 쓴다.

재료: collect.py가 만든 briefin.json(순위·급증 나라마다 최근 기사 제목 최대 20개, 공개하지 않음).
결과: brief.json {at, asof, countries: {ISO: {s: 요약 1~2문장, k: 핵심어, m: 읽은 제목 수}}} — 화면에 이것만 싣는다.
기사 제목 문장은 화면에 옮기지 않는다(언론사 표현 보호, 구글 광고 '복제 콘텐츠' 정책). 요약이 한국어 제목과
15자 넘게 그대로 겹치면 버린다. Claude 구독 열쇠(CLAUDE_CODE_OAUTH_TOKEN)로 2시간마다 한 번만 부른다.

사용: python3 pulse/collect/brief.py <작업 폴더>   (바뀌면 .changed를 만든다)
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import translate as TR  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
WAIT = timedelta(hours=2)
PROMPT = """아래 JSON은 나라마다 최근 24시간 동안 그 나라를 다룬 전 세계 기사 제목 일부(여러 언어의 표본)와 통계입니다.
나라마다 지금 무엇이 보도되고 있는지 한국어로 정리해, 같은 나라 코드를 키로 쓴 JSON 객체 하나만 출력하세요.
형식: {"US": {"s": "요약", "k": ["핵심어", "핵심어"]}}  설명이나 코드 블록 표시는 쓰지 마세요.
- s: 1~2문장, 120자 안, '~에 관한 보도가 많았습니다', '~가 이어졌습니다'처럼 보도 흐름을 전하는 합니다체.
- 기사 제목의 문장이나 독특한 표현을 그대로 옮기지 말고, 사실만 뽑아 직접 쓴 문장으로 씁니다. 따옴표 인용은 쓰지 않습니다.
- 제목에 없는 내용, 원인 추측, 평가, 전망은 쓰지 않습니다.
- 여러 제목에 되풀이되는 일을 먼저 쓰고, 한두 제목에만 나온 일은 빼도 됩니다.
- 제목들이 서로 관련 없이 흩어져 있으면 '뚜렷한 한 가지 이슈 없이 ○○와 ○○ 보도가 섞여 있습니다'처럼 씁니다.
- k: 핵심어 2~3개, 각각 10자 안의 명사(사람·지명은 국내 언론 표기).

"""
HANGUL = re.compile(r"[가-힣]")


def copied(s: str, titles: list[str]) -> bool:
    """한국어 제목과 15자 넘게 그대로 겹치면 True(띄어쓰기 무시)."""
    a = re.sub(r"\s+", "", s)
    for t in titles:
        if not HANGUL.search(t):
            continue
        b = re.sub(r"\s+", "", t)
        if any(b[i:i + 16] in a for i in range(0, max(1, len(b) - 15))):
            return True
    return False


def main():
    out = Path(sys.argv[1])
    bi, bp = out / "briefin.json", out / "brief.json"
    if not bi.exists():
        return
    old = json.loads(bp.read_text("utf-8")) if bp.exists() else {}
    if old.get("at") and datetime.now(KST) - datetime.fromisoformat(old["at"]) < WAIT:
        return
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        print("AI 요약 건너뜀: CLAUDE_CODE_OAUTH_TOKEN 없음")
        return
    data = json.loads(bi.read_text("utf-8"))
    cs = data.get("countries", {})
    if len(cs) < 15:
        # 제목 표본이 쌓이기 전(처음 몇 시간)에는 기다린다. 시각을 남기지 않아 다음 실행에서 다시 본다.
        print(f"AI 요약 미룸: 제목이 충분한 나라 {len(cs)}곳")
        return
    payload = {iso: {"나라": c["ko"], "24시간 기사 수": c["n"], "평소 대비": c["r"], "늘어난 사건 종류": c["e"], "기사 제목": c["t"]}
               for iso, c in cs.items()}
    try:
        got = TR.ask(PROMPT, payload)
    except Exception as e:  # noqa: BLE001 — 요약이 안 돼도 수집 결과는 그대로 올린다
        print(f"  ! AI 요약: {e.__class__.__name__}: {e}")
        return
    res, dropped = {}, []
    for iso, v in got.items():
        if iso not in cs or not isinstance(v, dict):
            continue
        s = (v.get("s") or "").strip().strip('"“”')
        k = [x.strip() for x in (v.get("k") or []) if isinstance(x, str) and 0 < len(x.strip()) <= 15][:3]
        if not (10 <= len(s) <= 200) or copied(s, cs[iso]["t"]):
            dropped.append(iso)
            continue
        res[iso] = {"s": s, "k": k, "m": len(cs[iso]["t"])}
    if not res:
        print("  ! AI 요약: 쓸 만한 답이 없음")
        return
    bp.write_text(json.dumps({"at": datetime.now(KST).isoformat(timespec="minutes"), "asof": data.get("asof"), "countries": res},
                             ensure_ascii=False, separators=(",", ":")), "utf-8")
    (out / ".changed").write_text("1")
    print(f"AI 요약: 나라 {len(cs)}곳 중 {len(res)}곳" + (f", 뺀 나라 {dropped}" if dropped else ""))


if __name__ == "__main__":
    main()
