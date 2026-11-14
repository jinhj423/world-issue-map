"""AI 요약 — 기사 제목 표본과 위키백과 사건 문장을 Claude가 읽고, 지금 무엇이 보도되는지 우리 말로 새로 쓴다.

재료: collect.py가 만든 briefin.json(나라마다 최근 기사 제목 최대 25개·위키백과 사건·늘어난 사건 종류, 공개하지 않음).
결과: brief.json — 화면에는 이것만 싣는다.
  countries: {ISO: {s: 한 줄 요약, pts: 이슈 2~3줄, k: 핵심어, m: 읽은 제목 수}}
  world: {items: [{t: 문장, c: [ISO…]}]} — 첫 화면 'AI 세계 브리핑'
원칙: 기사 제목 문장은 화면에 옮기지 않는다(언론사 표현 보호, 구글 광고 '복제 콘텐츠' 정책). 여러 제목에서 겹치는 사실을
뽑아 직접 쓴 문장만, 원인 추측·평가·전망 없이. 한국어 제목과 15자 넘게 그대로 겹치는 문장은 버린다.
Claude 구독 열쇠(CLAUDE_CODE_OAUTH_TOKEN)로 2시간마다: 나라 35곳씩 나눠 묻고, 그 결과로 세계 브리핑을 한 번 더 묻는다.

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
KEEP = timedelta(hours=6)      # 이번에 못 쓴 나라는 6시간 안의 지난 요약을 그대로 둔다
CHUNK = 35
RULES = """- 여러 제목에서 되풀이되거나 위키백과 사건 문장으로 확인되는 일을 먼저 씁니다. 한 제목에만 나온 일은 빼도 됩니다.
- 기사 제목의 문장이나 독특한 표현을 그대로 옮기지 말고, 사실만 뽑아 직접 쓴 문장으로 씁니다. 따옴표 인용은 쓰지 않습니다.
- 제목에 없는 내용, 원인 추측, 평가, 전망은 쓰지 않습니다. 숫자는 제목에 나온 것만 씁니다.
- 합니다체, 사람·지명·단체 이름은 국내 언론 표기를 따릅니다."""
PROMPT_C = """아래 JSON은 나라마다 최근 24시간 동안 그 나라를 다룬 전 세계 기사 제목 일부(여러 언어 표본, 최신순), 같은 기간 위키백과 주요 사건 문장, 평소보다 늘어난 사건 종류와 통계입니다.
나라마다 지금 무엇이 보도되고 있는지 한국어로 정리해, 같은 나라 코드를 키로 쓴 JSON 객체 하나만 출력하세요. 설명이나 코드 블록 표시는 쓰지 마세요.
형식: {"US": {"s": "한 줄 요약", "pts": ["이슈 한 줄", "이슈 한 줄"], "k": ["핵심어", "핵심어"]}}
- s: 그 나라 보도의 큰 흐름 한 문장, 90자 안.
- pts: 서로 다른 이슈 2~3개, 각각 무엇이 있었는지 한 문장(70자 안). 이슈가 하나뿐이면 1개도 됩니다.
- 제목들이 서로 관련 없이 흩어져 있으면 s를 '뚜렷한 한 가지 이슈 없이 여러 소식이 섞여 있습니다'처럼 쓰고 pts에 눈에 띄는 것만 적습니다.
- k: 핵심어 2~3개, 각각 10자 안의 명사.
""" + RULES + "\n\n"
PROMPT_W = """아래 JSON은 나라별 보도 요약(우리가 쓴 것), 위키백과 오늘의 주요 사건 문장, 평소보다 보도가 크게 늘어난 나라와 위험 사건이 늘어난 나라입니다.
이것만 바탕으로 '오늘 세계에서 많이 보도된 일' 5~6개를 골라 한국어로 정리해, JSON 객체 하나만 출력하세요. 설명이나 코드 블록 표시는 쓰지 마세요.
형식: {"items": [{"t": "한 문장(100자 안)", "c": ["관련 나라 코드", "..."]}]}
- 여러 나라에 걸친 큰 일, 보도가 크게 늘어난 일, 무력 충돌·제재·재난처럼 영향이 큰 일을 먼저 고릅니다. 스포츠·연예는 아주 크게 다뤄질 때만.
- c에는 위 자료에 나온 나라 코드만, 관련이 큰 순서로 1~3개.
""" + RULES + "\n\n"
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


def clean(v) -> str:
    return (v or "").strip().strip('"“”') if isinstance(v, str) else ""


def country_chunk(cs: dict, isos: list[str]) -> dict:
    payload = {iso: {"나라": cs[iso]["ko"], "24시간 기사 수": cs[iso]["n"], "평소 대비": cs[iso]["r"],
                     "늘어난 사건 종류(이름, 기사 수, 평소 대비)": cs[iso]["e"], "위키백과 사건": cs[iso].get("w", []),
                     "기사 제목": cs[iso]["t"]} for iso in isos}
    got = TR.ask(PROMPT_C, payload)
    res = {}
    for iso, v in got.items():
        if iso not in cs or not isinstance(v, dict):
            continue
        titles = cs[iso]["t"]
        s = clean(v.get("s"))
        pts = [clean(x) for x in (v.get("pts") or []) if 8 <= len(clean(x)) <= 120 and not copied(clean(x), titles)][:3]
        k = [clean(x) for x in (v.get("k") or []) if 0 < len(clean(x)) <= 15][:3]
        if 10 <= len(s) <= 160 and not copied(s, titles):
            res[iso] = {"s": s, "pts": pts, "k": k, "m": len(titles)}
    return res


def main():
    out = Path(sys.argv[1])
    bi, bp = out / "briefin.json", out / "brief.json"
    if not bi.exists():
        return
    old = json.loads(bp.read_text("utf-8")) if bp.exists() else {}
    now = datetime.now(KST)
    if old.get("at") and now - datetime.fromisoformat(old["at"]) < WAIT:
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
    isos = list(cs)
    res, failed = {}, 0
    for i in range(0, len(isos), CHUNK):
        try:
            res.update(country_chunk(cs, isos[i:i + CHUNK]))
        except Exception as e:  # noqa: BLE001 — 한 묶음이 안 돼도 나머지는 쓴다
            failed += 1
            print(f"  ! AI 요약 묶음 {i // CHUNK + 1}: {e.__class__.__name__}: {e}")
    if not res:
        print("  ! AI 요약: 쓸 만한 답이 없음")
        return
    # 이번에 못 쓴 나라는 6시간 안의 지난 요약을 남긴다
    if old.get("at") and now - datetime.fromisoformat(old["at"]) < KEEP:
        for iso, v in (old.get("countries") or {}).items():
            res.setdefault(iso, v)
    world = old.get("world") if old.get("world") and failed else None
    try:
        w = data.get("world", {})
        got = TR.ask(PROMPT_W, {"나라별 요약": {iso: {"나라": cs[iso]["ko"] if iso in cs else iso, "요약": v["s"], "이슈": v.get("pts", [])}
                                            for iso, v in res.items()},
                                "위키백과 주요 사건": w.get("wiki", []), "보도가 크게 늘어난 나라(코드, 이름, 평소 대비 배수)": w.get("surge", []),
                                "위험 사건이 늘어난 나라(코드, 이름, 늘어난 사건 종류)": w.get("alert", [])})
        ok = set(res) | {x[0] for x in w.get("surge", []) + w.get("alert", []) if x}
        items = []
        for it in got.get("items") or []:
            t = clean((it or {}).get("t"))
            c = [x for x in ((it or {}).get("c") or []) if isinstance(x, str) and x in ok][:3]
            if 10 <= len(t) <= 160:
                items.append({"t": t, "c": c})
        if items:
            world = {"items": items[:6]}
    except Exception as e:  # noqa: BLE001
        print(f"  ! AI 세계 브리핑: {e.__class__.__name__}: {e}")
    outj = {"at": now.isoformat(timespec="minutes"), "asof": data.get("asof"), "countries": res,
            "m": sum(len(v["t"]) for v in cs.values()), "w": len(data.get("world", {}).get("wiki", []))}
    if world:
        outj["world"] = world
    bp.write_text(json.dumps(outj, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (out / ".changed").write_text("1")
    print(f"AI 요약: 나라 {len(cs)}곳 중 {len(res)}곳, 세계 브리핑 {len((world or {}).get('items', []))}줄")


if __name__ == "__main__":
    main()
