"""위키백과 주요 사건(news.json)의 영어 문장을 한국어로 옮긴다 — Claude 구독 열쇠(CLAUDE_CODE_OAUTH_TOKEN)로 Claude Code를 부른다.

번역은 ko.json(영어 문장 해시 → 한국어)에 쌓아 두고, 아직 없는 문장만 묶어서 한 번에 부른다.
새 문장이 없으면 아무것도 하지 않고, 마지막 번역 뒤 30분이 안 됐으면 새 문장이 10개를 넘을 때만 부른다(사용량 절약).
옮긴 문장도 위키백과와 같은 CC BY-SA 4.0을 따르고, 화면에 기계 번역이라고 밝힌다.

사용: python3 pulse/collect/translate.py <작업 폴더>   (바뀌면 .changed를 만든다)
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
WAIT = timedelta(minutes=30)
PROMPT = """아래 JSON 객체의 값은 위키백과 'Portal:Current events'의 영어 문장, 주제 이름, 사건 문서의 첫 문단(배경)입니다.
각 값을 한국어로 옮겨, 같은 키를 가진 JSON 객체 하나만 출력하세요. 설명·코드 블록 표시는 쓰지 마세요.
- 문장은 '~했습니다', '~밝혔습니다'처럼 합니다체로, 원문에 없는 내용은 더하지 않습니다.
- 사람·지명·단체 이름은 국내 언론이 흔히 쓰는 표기를 따르고, 낯선 이름은 외래어 표기법대로 씁니다.
- 숫자·날짜는 그대로 두고, 주제 이름(짧은 명사구)은 짧은 명사구로 옮깁니다.

"""


def key(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def apply(news: dict, cache: dict) -> bool:
    """news.json 항목에 번역(ko: 문장, kp: 주제)을 붙인다. 바뀐 게 있으면 True."""
    changed = False
    for d in news.get("days", []):
        for it in d.get("items", []):
            for src, dst in (("text", "ko"), ("topic", "kp"), ("bg", "bgk")):
                v = cache.get(key(it.get(src) or "")) if it.get(src) else None
                if v and it.get(dst) != v:
                    it[dst] = v
                    changed = True
    return changed


def ask(prompt: str, payload: dict) -> dict:
    """Claude Code(구독 열쇠)에 한 번 묻고 답의 JSON 객체를 돌려준다. brief.py도 같이 쓴다."""
    cmd = ["npx", "-y", "@anthropic-ai/claude-code@latest", "-p", prompt + json.dumps(payload, ensure_ascii=False, indent=0),
           "--model", "sonnet", "--output-format", "json", "--max-turns", "1"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"claude 종료 코드 {r.returncode}: {(r.stderr or r.stdout)[-300:]}")
    res = json.loads(r.stdout).get("result", "")
    a, b = res.find("{"), res.rfind("}")
    return json.loads(res[a:b + 1]) if a >= 0 < b else {}


def call_claude(todo: dict) -> dict:
    out = ask(PROMPT, todo)
    return {k: v.strip() for k, v in out.items() if k in todo and isinstance(v, str) and v.strip()}


def main():
    out = Path(sys.argv[1])
    np_, kp = out / "news.json", out / "ko.json"
    if not np_.exists():
        return
    news = json.loads(np_.read_text("utf-8"))
    ko = json.loads(kp.read_text("utf-8")) if kp.exists() else {"at": "", "t": {}}
    cache = ko.setdefault("t", {})
    todo = {}
    for d in news.get("days", []):
        for it in d.get("items", []):
            for s in (it.get("text"), it.get("topic"), it.get("bg")):
                if s and key(s) not in cache:
                    todo[key(s)] = s
    changed = apply(news, cache)
    recent = ko.get("at") and datetime.now(KST) - datetime.fromisoformat(ko["at"]) < WAIT
    if todo and (not recent or len(todo) > 10) and os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        try:
            got = call_claude(todo)
            cache.update(got)
            ko["at"] = datetime.now(KST).isoformat(timespec="minutes")
            # 위키백과 두 날짜에서 빠진 문장의 번역은 사흘 뒤 지운다(파일 크기)
            live = {key(s) for d in news.get("days", []) for it in d.get("items", []) for s in (it.get("text"), it.get("topic"), it.get("bg")) if s}
            ko.setdefault("seen", {}).update({k: ko["at"][:10] for k in live})
            old = (datetime.now(KST) - timedelta(days=3)).date().isoformat()
            for k in [k for k, day in ko["seen"].items() if day < old and k not in live]:
                cache.pop(k, None)
                ko["seen"].pop(k, None)
            kp.write_text(json.dumps(ko, ensure_ascii=False, separators=(",", ":")), "utf-8")
            changed = apply(news, cache) or changed
            print(f"번역: 새 문장 {len(todo)}개 중 {len(got)}개")
        except Exception as e:  # noqa: BLE001 — 번역이 안 돼도 수집 결과는 그대로 올린다
            print(f"  ! 번역: {e.__class__.__name__}: {e}")
    elif todo:
        print(f"번역 미룸: 새 문장 {len(todo)}개" + ("" if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN") else " (CLAUDE_CODE_OAUTH_TOKEN 없음)"))
    if changed:
        np_.write_text(json.dumps(news, ensure_ascii=False, separators=(",", ":")), "utf-8")
        (out / ".changed").write_text("1")


if __name__ == "__main__":
    main()
