"""위키백과 'Portal:Current events'(영어)에서 그날의 주요 사건 한 줄 요약을 읽는다.

이용 조건: 위키백과 글은 CC BY-SA 4.0. 출처(페이지 주소·편집자)와 라이선스를 밝히고, 바꾼 점(서식·링크 제거)을 적으면
상업 사이트에도 쓸 수 있다. 옮긴 문장은 같은 라이선스로 둔다(화면 아래 표기).
페이지는 UTC 날짜별(Portal:Current_events/2026_November_14)이고, 원문 위키 문법을 action=raw로 받는다.
"""
from __future__ import annotations

import html
import re
from datetime import date

CATS = {
    "Armed conflicts and attacks": "무력 충돌·공격",
    "Arts and culture": "문화·예술",
    "Business and economy": "경제·기업",
    "Disasters and accidents": "재난·사고",
    "Health and environment": "보건·환경",
    "International relations": "국제 관계",
    "Law and crime": "법·범죄",
    "Politics and elections": "정치·선거",
    "Science and technology": "과학·기술",
    "Sports": "스포츠",
}

# 나라 이름 말고도 자주 쓰는 형용사·수도·단체 이름(대소문자 그대로 맞춘다). 애매한 낱말(American, Georgia, Indian Ocean 등)은 넣지 않는다.
ALIASES = {
    "US": ["United States", "U.S.", "USA", "New Mexico", "White House", "Pentagon"],
    "GB": ["United Kingdom", "UK", "British", "Britain", "England", "English Channel", "Scotland", "Scottish", "Wales", "Welsh", "Northern Ireland", "London"],
    "RU": ["Russian", "Moscow", "Kremlin"], "UA": ["Ukrainian", "Kyiv"], "BY": ["Belarusian", "Minsk"],
    "CN": ["Chinese", "Beijing"], "TW": ["Taiwanese", "Taipei"], "HK": [], "JP": ["Japanese", "Tokyo"],
    "KR": ["South Korean", "Seoul"], "KP": ["North Korean", "Pyongyang"], "IN": ["New Delhi"], "PK": ["Pakistani", "Islamabad"],
    "AF": ["Afghan", "Kabul", "Taliban"], "BD": ["Bangladeshi", "Dhaka"], "MM": ["Myanmar"], "TH": ["Thai", "Bangkok"],
    "VN": ["Vietnamese", "Hanoi"], "PH": ["Philippine", "Filipino", "Manila"], "ID": ["Indonesian", "Jakarta"], "MY": ["Malaysian"],
    "IR": ["Iranian", "Tehran"], "IQ": ["Iraqi", "Baghdad"], "SY": ["Syrian", "Damascus"], "LB": ["Lebanese", "Beirut", "Hezbollah"],
    "IL": ["Israeli", "Tel Aviv", "Knesset"], "PS": ["Palestine", "Palestinian", "Gaza", "Gaza Strip", "West Bank", "Hamas"],
    "JO": ["Jordanian", "Amman"], "SA": ["Saudi", "Saudi Arabian", "Riyadh"], "YE": ["Yemeni", "Houthi", "Houthis"],
    "AE": ["United Arab Emirates", "UAE", "Emirati", "Dubai", "Abu Dhabi"], "QA": ["Qatari", "Doha"], "BH": ["Bahraini"],
    "KW": ["Kuwaiti"], "OM": ["Omani"], "TR": ["Türkiye", "Turkish", "Ankara", "Istanbul"], "EG": ["Egyptian", "Cairo"],
    "LY": ["Libyan", "Tripoli"], "SD": ["Sudanese", "Khartoum"], "SS": ["South Sudanese", "Juba"], "ET": ["Ethiopian", "Addis Ababa"],
    "SO": ["Somali", "Mogadishu", "Al-Shabaab"], "KE": ["Kenyan", "Nairobi"], "NG": ["Nigerian", "Abuja", "Lagos"],
    "ZA": ["South African", "Johannesburg", "Pretoria"], "CD": ["DR Congo", "DRC", "Kinshasa"], "CG": ["Brazzaville"],
    "CI": ["Côte d'Ivoire", "Ivorian"], "ML": ["Malian", "Bamako"], "BF": ["Burkinabè"], "NE": ["Nigerien", "Niamey"],
    "DE": ["German", "Berlin", "Bundestag"], "FR": ["French", "Paris"], "IT": ["Italian", "Rome"], "ES": ["Spanish", "Madrid"],
    "PT": ["Portuguese", "Lisbon"], "NL": ["Netherlands", "Dutch", "Amsterdam"], "BE": ["Belgian", "Brussels"],
    "PL": ["Polish", "Warsaw"], "SE": ["Swedish", "Stockholm"], "NO": ["Norwegian", "Oslo"], "FI": ["Finnish", "Helsinki"],
    "DK": ["Danish", "Copenhagen"], "GR": ["Greek", "Athens"], "HU": ["Hungarian", "Budapest"], "RO": ["Romanian", "Bucharest"],
    "CZ": ["Czechia", "Czech", "Prague"], "AT": ["Austrian", "Vienna"], "CH": ["Swiss", "Geneva", "Bern"], "IE": ["Irish", "Dublin"],
    "RS": ["Serbian", "Belgrade"], "AM": ["Armenian", "Yerevan"], "AZ": ["Azerbaijani", "Baku"], "GE": ["Georgia (country)", "Tbilisi"],
    "MK": ["North Macedonia"], "SZ": ["Eswatini"], "TL": ["Timor-Leste"], "CV": ["Cabo Verde"], "VA": ["Holy See", "Pope"],
    "CA": ["Canadian", "Ottawa"], "MX": ["Mexican", "Mexico City"], "BR": ["Brazilian", "Brasília"], "AR": ["Argentine", "Buenos Aires"],
    "CO": ["Colombian", "Bogotá"], "VE": ["Venezuelan", "Caracas"], "CL": ["Chilean", "Santiago"], "PE": ["Peruvian", "Lima"],
    "CU": ["Cuban", "Havana"], "HT": ["Haitian", "Port-au-Prince"], "AU": ["Australian", "Canberra", "Sydney"], "NZ": ["New Zealand"],
}
SKIP_NAMES = {"Georgia"}  # 미국 주 이름과 겹친다

SECT = re.compile(r"^'''\s*(.+?)\s*'''\s*$")
OLD_SECT = re.compile(r"^;\s*(.+?)\s*$")
BULLET = re.compile(r"^(\*+)\s*(.*)$")
EXT = re.compile(r"\[(https?://[^\s\]]+)(?:\s+([^\]]*))?\]")
LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]*))?\]\]")
TPL = re.compile(r"\{\{[^{}]*\}\}")
REF = re.compile(r"<ref[^>]*?/>|<ref[^>]*>.*?</ref>", re.S)
TAG = re.compile(r"<[^>]+>")


def summary_url(title: str) -> str:
    """위키백과 문서 첫 문단(요약) REST 주소."""
    from urllib.parse import quote
    return "https://en.wikipedia.org/api/rest_v1/page/summary/" + quote(title.replace(" ", "_"), safe="")


def page_url(d: date) -> str:
    return f"https://en.wikipedia.org/wiki/Portal:Current_events/{d.year}_{d.strftime('%B')}_{d.day}"


def raw_url(d: date) -> str:
    return f"https://en.wikipedia.org/w/index.php?title=Portal:Current_events/{d.year}_{d.strftime('%B')}_{d.day}&action=raw"


def plain(s: str) -> tuple[str, list[str], list[list[str]]]:
    """위키 문법 한 줄 → (평문, 내부 링크 대상들, 출처[[이름, 주소]])."""
    srcs = []

    def ext(m):
        label = (m.group(2) or "").strip().strip("()").replace("''", "").strip()
        srcs.append([label or re.sub(r"^https?://(www\.)?([^/]+).*$", r"\2", m.group(1)), m.group(1)])
        return ""

    s = REF.sub("", s)
    s = EXT.sub(ext, s)
    targets = [m.group(1).strip() for m in LINK.finditer(s)]
    s = LINK.sub(lambda m: (m.group(2) if m.group(2) is not None else m.group(1)), s)
    for _ in range(3):
        s = TPL.sub("", s)
    s = TAG.sub("", s).replace("'''", "").replace("''", "")
    s = html.unescape(re.sub(r"\s+", " ", s)).strip()
    s = re.sub(r"\s+([.,;:])", r"\1", s)
    return s, targets, srcs


def parse(raw: str) -> list[dict]:
    """한 날짜 페이지의 위키 문법 → 사건 목록. 출처 링크가 붙은 줄을 사건 한 줄로 보고, 위 단계 줄을 주제로 붙인다."""
    a = raw.find("<!-- All news items below this line -->")
    b = raw.find("<!-- All news items above this line -->")
    body = raw[a:b] if a >= 0 and b > a else raw
    items, cat, stack = [], "", []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("<!--"):
            continue
        m = SECT.match(line) or OLD_SECT.match(line)
        if m:
            cat, stack = m.group(1).strip(), []
            continue
        m = BULLET.match(line)
        if not m:
            continue
        depth, content = len(m.group(1)), m.group(2)
        text, targets, srcs = plain(content)
        del stack[depth - 1:]
        if srcs and text:
            topics = [t for t, _ in stack]
            # 배경 문서: 가장 가까운 위 단계 줄의 첫 링크(대개 그 사건을 다룬 위키백과 문서)
            near = next((ts[0] for _, ts in reversed(stack) if ts), "")
            items.append({"cat": cat, "topic": topics, "text": text, "src": srcs, "wt": near,
                          "links": sorted({x for _, ts in stack for x in ts} | set(targets))})
        stack.append((text, targets))
    return items


class Matcher:
    """문장·링크에서 나라를 찾는다. 긴 이름을 먼저 맞춰 'South Sudan'이 'Sudan'으로 잡히지 않게 한다."""

    def __init__(self, rows: dict):
        names: dict[str, str] = {}
        for iso, r in rows.items():
            if r["en"] not in SKIP_NAMES:
                names[r["en"]] = iso
        for iso, al in ALIASES.items():
            if iso in rows:
                for x in al:
                    names[x] = iso
        self.names = names
        alts = sorted(names, key=len, reverse=True)
        self.rx = re.compile(r"(?<!\w)(" + "|".join(re.escape(x) for x in alts) + r")(?!\w)")

    def find(self, item: dict) -> list[str]:
        hit: dict[str, int] = {}
        for t in item["links"]:
            iso = self.names.get(t)
            if iso:
                hit[iso] = hit.get(iso, 0) + 2
        for s in [item["text"], *item["topic"]]:
            for m in self.rx.finditer(s):
                iso = self.names[m.group(1)]
                hit[iso] = hit.get(iso, 0) + 1
        return [k for k, _ in sorted(hit.items(), key=lambda x: -x[1])][:4]
