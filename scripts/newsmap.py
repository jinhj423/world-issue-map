"""
세계 이슈 지도 — 공통 처리 로직 (표준 라이브러리만 사용, AI 토큰 소모 없음)

수집기(fetch_news.py)와 미리보기 빌더(build_from_seed.py)가 같은 로직을 쓰도록
분류·키워드·군집·이슈 지수 계산을 이 파일에 모았다.
"""
from __future__ import annotations

import json
import math
import re
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))

# ─────────────────────────── 분야 분류 ───────────────────────────
# 우선순위 순서(동점이면 앞쪽). 가중치는 '이슈성'에 반영된다 — 분쟁·재난이 같은 보도량이면 더 뜨겁게.
CATEGORIES = [
    ("conflict", "분쟁·안보", 1.3, [
        "전쟁", "공습", "폭격", "미사일", "드론", "교전", "휴전", "군사", "병력", "침공", "테러",
        "포격", "핵", "국방", "안보", "인질", "반군", "쿠데타", "총격", "분쟁", "피란", "난민", "하마스",
        "헤즈볼라", "후티", "나토", "NATO", "전투", "탄도", "무기", "군함", "전투기", "사살", "공격", "계엄",
        "무장", "파병", "합참", "격추", "점령", "봉쇄", "징집",
    ]),
    ("health", "보건·의료", 1.1, [
        "전염병", "감염", "확진", "바이러스", "코로나", "독감", "콜레라", "에볼라", "말라리아", "백신",
        "방역", "보건", "의료", "질병", "WHO", "신약", "치료제", "의약", "발병", "집단감염",
    ]),
    ("disaster", "재난·사고", 1.3, [
        "지진", "태풍", "홍수", "폭우", "산불", "화재", "사고", "추락", "붕괴", "폭설", "허리케인",
        "사이클론", "가뭄", "폭염", "쓰나미", "화산", "참사", "실종", "구조", "사망", "부상", "탈선",
        "침몰", "산사태", "한파", "폭발",
    ]),
    ("politics", "정치·외교", 1.1, [
        "대통령", "총리", "선거", "대선", "총선", "중간선거", "의회", "정상회담", "회담", "외교", "장관",
        "탄핵", "정당", "여당", "야당", "투표", "시위", "집회", "내각", "국회", "제재", "협정", "정상",
        "방문", "대사", "유엔", "UN", "정권", "개헌", "트럼프", "시진핑", "푸틴", "젤렌스키", "총통",
        "국왕", "왕세자", "연정", "사임", "취임", "당선", "의원", "상원", "하원", "공화당", "민주당",
    ]),
    ("energy", "에너지·자원", 1.0, [
        "유가", "원유", "석유", "OPEC", "가스", "LNG", "셰일", "정유", "전력", "정전", "송전", "발전소",
        "원전", "원자력", "석탄", "수소", "태양광", "풍력", "재생에너지", "배럴", "광물", "희토류", "리튬",
        "니켈", "구리", "광산", "휘발유", "전기요금", "에너지",
    ]),
    ("economy", "경제·시장", 1.0, [
        "경제", "증시", "주가", "금리", "환율", "관세", "무역", "수출", "수입", "물가", "인플레", "GDP",
        "성장률", "기업", "투자", "시장", "달러", "엔화", "위안", "채권", "중앙은행", "연준", "Fed",
        "실적", "반도체", "부동산", "고용", "실업", "은행", "코스피", "나스닥", "다우",
        "비트코인", "가상자산", "예산", "재정", "국채", "공급망", "침체", "불황", "둔화", "매출", "흑자", "적자", "IPO", "상장",
        "주식", "펀드", "M&A", "인수", "합병", "수주",
    ]),
    ("tech", "기술·과학", 0.9, [
        "AI", "인공지능", "우주", "위성", "로켓", "기술", "테크", "애플", "구글", "엔비디아", "로봇",
        "배터리", "전기차", "챗GPT", "오픈AI", "OpenAI", "양자", "데이터센터", "스타트업", "5G", "6G",
    ]),
    ("sports", "스포츠", 0.6, [
        "축구", "야구", "농구", "배구", "골프", "테니스", "올림픽", "월드컵", "아시안게임", "프리미어리그",
        "분데스리가", "라리가", "세리에", "K리그", "MLB", "NBA", "NHL", "F1", "마라톤", "선수", "구단",
        "이적", "우승", "결승", "득점", "홈런", "메달", "손흥민", "이강인", "김민재", "오타니",
    ]),
    ("society", "사회·문화", 0.8, [
        "범죄", "법원", "재판", "판결", "교육", "노동", "파업", "이민", "인권", "영화", "K팝", "관광", "한류", "체포", "수사", "검찰", "경찰", "학교", "대학",
        "축제", "공연", "여행", "비자", "출산", "인구",
    ]),
]
CAT_LABEL = {k: label for k, label, _, _ in CATEGORIES}
CAT_LABEL["etc"] = "기타"
CAT_WEIGHT = {k: w for k, _, w, _ in CATEGORIES}
CAT_WEIGHT["etc"] = 0.8


def classify(title: str) -> str:
    best, best_hits = "etc", 0
    for key, _, _, words in CATEGORIES:
        hits = sum(1 for w in words if w in title)
        if hits > best_hits:
            best, best_hits = key, hits
    return best


# ─────────────────────────── 키워드 추출 ───────────────────────────
TOKEN_RE = re.compile(r"[가-힣A-Za-z0-9一-龥]+")
PARTICLES = sorted([
    "에서는", "으로는", "에게서", "이라고", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "이라",
    "라는", "이다", "했다", "한다", "하는", "하고", "하며", "됐다", "된다", "에도", "에는", "와의", "과의",
    "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "만", "로", "서",
], key=len, reverse=True)
STOPWORDS = set("""
속보 종합 단독 영상 포토 사진 뉴스 오늘 내일 어제 기자 1보 2보 3보 상보 현지 시간 대해 관련 위해 대한 등 것 수 더 첫 또
이번 올해 지난 최대 최초 사실상 가능성 발표 전망 우려 논란 확인 결국 하루 만에 이후 이상 진행 나서 밝혀 주목 공식 직접
현장 최근 계속 다시 이미 모두 각국 세계 글로벌 국제 정부 당국 지역 국가 전 후 중 앞 뒤 간 측 명 개 건 년 월 일 시 분
있다 없다 했다 한다 된다 됐다 위한 통해 따라 대비 관해 주요 사상 역대 잇따라 이어져 순조롭게 운명 새로운 여전히 본격 the of to in and for on a is at by with as
""".split())


# 조사처럼 보이지만 단어의 일부인 끝말(회의의 '의', 두바이의 '이', 보고서의 '서' 등)
PROTECT_SUFFIX = ("회의", "주의", "결의", "협의", "논의", "합의", "동의", "바이", "하이", "와이", "과이",
                  "레이", "타이", "전문가", "보고서", "계약서", "성명서", "선언서", "활주로", "교과서")
# 동사·부사 활용형은 이슈어가 아니다(순조롭게, 이어져, 밝히며 …)
VERBAL_END = ("게", "져", "며", "면", "려고", "는데", "하다", "했다", "된다", "한다", "적인", "적으로", "해야",
              "했고", "하자", "지만", "으며", "었다", "았다", "겠다")
NUMERIC_RE = re.compile(r"^\d[\d.,]*[가-힣%]{0,2}$")  # 11월, 2027년, 5700선, 3%


# 나라마다 흔히 나오는 일반어 — 국가별 단어로는 두되 '여러 나라 공통 이슈'에서는 뺀다
GLOBAL_GENERIC = set("대통령 총리 공격 개최 장관 회담 협력 발표 정부 의회 대표 경제 시장 사망 부상 지원 계획 요구 경고 "
                     "논의 합의 방문 강화 추진 확대 회복 위기 갈등 협상 정책 국민 시민".split())


def normalize_token(tok: str) -> str:
    if tok.endswith(PROTECT_SUFFIX):
        return tok
    for p in PARTICLES:
        if tok.endswith(p) and len(tok) - len(p) >= 2:
            return tok[: -len(p)]
    return tok


def tokens(title: str) -> list[str]:
    out = []
    for raw in TOKEN_RE.findall(title):
        t = normalize_token(raw)
        if (len(t) < 2 or NUMERIC_RE.match(t) or t in STOPWORDS or t.lower() in STOPWORDS
                or (len(t) >= 3 and t.endswith(VERBAL_END))):
            continue
        out.append(t)
    return out


def extract_keywords(titles: list[str], drop: set[str], k: int = 6) -> list[str]:
    """여러 헤드라인에 반복해서 나오는 단어 = 그 나라의 핵심 이슈어."""
    df: dict[str, int] = {}
    for t in titles:
        for tok in set(tokens(t)):
            if tok in drop or any(tok.startswith(d) for d in drop if len(d) >= 2):
                continue
            df[tok] = df.get(tok, 0) + 1
    ranked = sorted(df.items(), key=lambda x: (-x[1], -len(x[0])))
    min_df = 2 if len(titles) >= 6 else 1
    return [w for w, c in ranked if c >= min_df][:k]


# ─────────────────────────── 제목 정리·필터·군집 ───────────────────────────
BRACKET_RE = re.compile(r"^\s*[\[【(<]([^\]】)>]{1,12})[\]】)>]\s*")


def clean_title(title: str, source: str | None = None) -> str:
    t = re.sub(r"\s+", " ", title or "").strip()
    if source and t.endswith(" - " + source):
        t = t[: -(len(source) + 3)].strip()
    elif " - " in t:  # 구글 뉴스: "제목 - 언론사"
        head, _, tail = t.rpartition(" - ")
        if len(tail) <= 25:
            t = head.strip()
    return t


def mentions_country(title: str, country: dict) -> bool:
    """별칭이 제외 패턴(예: 中企, 中東) 안에만 있으면 그 나라 기사로 보지 않는다."""
    aliases = country.get("aliases") or []
    if not aliases:
        return True
    t = title
    for ex in country.get("exclude") or []:
        t = t.replace(ex, " ")
    return any(a in t for a in aliases)


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cluster_items(items: list[dict], threshold: float = 0.45, min_shared: int = 0) -> list[dict]:
    """같은 사건을 다룬 비슷한 제목은 하나로 합치고, 합쳐진 수를 k(군집 크기)에 더한다.
    sc = 그 사건을 다룬 서로 다른 언론사 수. 2 이상이면 교차 확인된 사건으로 본다."""
    kept: list[list] = []  # [토큰집합, 대표기사, 언론사집합]
    for it in items:
        toks = set(tokens(it["t"]))
        src = (it.get("s") or "").strip()
        more = set(it.pop("ss", None) or [])  # 구글 묶음 안 다른 언론사
        for ent in kept:
            if _jaccard(toks, ent[0]) >= threshold or (min_shared and len(toks & ent[0]) >= min_shared):
                ent[1]["k"] = ent[1].get("k", 1) + it.get("k", 1)
                ent[1]["pw"] = max(ent[1].get("pw", 1), it.get("pw", 1))
                if src:
                    ent[2].add(src)
                ent[2] |= more
                break
        else:
            kept.append([toks, it, ({src} if src else set()) | more])
    out = []
    for _, it, srcs in kept:
        if len(srcs) > 1:
            it["sc"] = len(srcs)
        out.append(it)
    return out


# ─────────────────────────── 이슈 지수 ───────────────────────────
def recency_weight(published: str | None, now: datetime) -> float:
    if not published:
        return 0.7
    try:
        dt = datetime.fromisoformat(published)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KST)
    except ValueError:
        return 0.7
    hours = (now - dt).total_seconds() / 3600
    if hours <= 24:
        return 1.0
    if hours <= 48:
        return 0.6
    return 0.3


def country_weight(items: list[dict], now: datetime) -> float:
    return sum(it.get("k", 1) * CAT_WEIGHT[it["c"]] * recency_weight(it.get("p"), now) for it in items)


def surge_ratio(history: dict, a2: str, today: str, w_today: float) -> float | None:
    past = [v for d, v in sorted((history.get(a2) or {}).items()) if d < today][-7:]
    if len(past) < 3:
        return None  # 기록이 3일 미만이면 '평소'를 아직 모름
    base = statistics.median(past)
    return (w_today + 1) / (base + 1)


def heat_score(w: float, w_ref: float, ratio: float | None) -> tuple[int, float, float]:
    """이슈 지수 0~100 = 보도량 60% + 평소 대비 급증 40%.
    급증률을 모르면 '평소 수준(0.5)'으로 둔다."""
    vol = min(1.0, math.log1p(w) / math.log1p(max(w_ref, 1.0)))
    surge = 0.5 if ratio is None else max(0.0, min(1.0, 0.5 + math.log2(ratio) / 4))
    return round(100 * (0.6 * vol + 0.4 * surge)), vol, surge


def load_countries() -> list[dict]:
    return json.loads((ROOT / "config" / "countries.json").read_text("utf-8"))["countries"]


def build_dataset(raw: dict[str, dict], history: dict, now: datetime, source_note: str,
                  filter_mentions: bool = True) -> dict:
    """raw: {A2: {"items": [{t,s,u,p}], "local": [...]}} → 사이트가 읽는 news.json"""
    countries = {c["a2"]: c for c in load_countries()}
    today = now.astimezone(KST).date().isoformat()
    out: dict[str, dict] = {}
    weights: dict[str, float] = {}

    for a2, c in countries.items():
        r = raw.get(a2) or {}
        items = []
        for it in r.get("items", []):
            t = clean_title(it.get("t", ""), it.get("s"))
            if not t or (filter_mentions and not mentions_country(t, c)):
                continue
            items.append({**it, "t": t, "c": classify(t), "k": it.get("k", 1)})
        # 최신순 정렬 후 군집
        items.sort(key=lambda x: x.get("p") or "", reverse=True)
        items = cluster_items(items)
        # 교차 확인(관련 기사 2건 이상 또는 언론사 2곳 이상)된 사건이 대표 자리에 먼저 온다
        items.sort(key=lambda x: ((x["k"] >= 2 or x.get("sc", 1) >= 2),
                                  x["k"] * CAT_WEIGHT[x["c"]], x.get("p") or ""), reverse=True)
        w = country_weight(items, now)
        weights[a2] = w
        cats: dict[str, float] = {}
        for it in items:
            cats[it["c"]] = cats.get(it["c"], 0) + it["k"]
        drop = set(c.get("aliases") or []) | {c["ko"]}
        out[a2] = {
            "ko": c["ko"], "region": c["region"], "id": c["id"], "lon": c["lon"], "lat": c["lat"],
            "point": c.get("point", False), "w": round(w, 2), "n": len(items),
            "cat": max(cats, key=cats.get) if cats else None,
            "cats": cats,
            "kw": extract_keywords([it["t"] for it in items], drop),
            "items": items[:20],
            "local": (r.get("local") or [])[:10],
        }

    # 기준값: 상위 3개국 보도량 평균 — 한 나라(미국)가 혼자 튀어도 나머지가 다 하얘지지 않게
    top = sorted(weights.values(), reverse=True)[:3]
    w_ref = sum(top) / len(top) if top else 1.0
    for a2, d in out.items():
        ratio = surge_ratio(history, a2, today, d["w"])
        d["heat"], vol, surge = heat_score(d["w"], w_ref, ratio)
        d["surge"] = None if ratio is None else round(ratio, 2)
        if d["n"] == 0:
            d["heat"] = 0

    # 전 세계 공통 키워드(여러 나라에 동시에 등장하는 단어 = 글로벌 이슈)
    kw_countries: dict[str, list[str]] = {}
    for a2, d in out.items():
        for kw in d["kw"]:
            kw_countries.setdefault(kw, []).append(a2)
    global_kw = sorted(((k, v) for k, v in kw_countries.items() if k not in GLOBAL_GENERIC),
                       key=lambda x: -len(x[1]))
    global_kw = [{"kw": k, "countries": v} for k, v in global_kw if len(v) >= 2][:12]

    ranking = sorted((a2 for a2 in out if out[a2]["n"]), key=lambda a: -out[a]["heat"])
    return {
        "updated_at": now.astimezone(KST).isoformat(timespec="minutes"),
        "source": source_note,
        "categories": CAT_LABEL,
        "ranking": ranking,
        "global_keywords": global_kw,
        "countries": out,
    }


TOPIC_STOP = {"속보", "종합", "단독", "오늘", "내일", "어제", "올해", "시장", "투자", "가격", "전망", "대비", "기업", "정부",
              "한국", "미국", "중국", "이유", "상승", "하락", "급등", "급락", "목표주", "목표가", "마감", "발표", "확대", "추진",
              "인정", "공개", "주가", "논란", "강화", "최대", "역대", "기록"}


def build_topic(items: list[dict], now: datetime, limit: int = 40) -> dict:
    """경제·화제처럼 나라와 상관없는 묶음: 같은 사건을 합치고, 많이 다뤄지고 최근인 순으로."""
    seen_u: set[str] = set()
    rows = []
    for it in items:
        t = clean_title(it.get("t", ""), it.get("s"))
        if not t or it.get("u") in seen_u:
            continue
        seen_u.add(it.get("u"))
        rows.append({**it, "t": t, "c": classify(t), "k": it.get("k", 1)})
    rows.sort(key=lambda x: x.get("p") or "", reverse=True)
    rows = cluster_items(rows, threshold=0.4, min_shared=4)
    rows = [r for r in rows if recency_weight(r.get("p"), now) >= 1.0]  # 최근 24시간만

    def score(x: dict) -> float:
        try:
            age = (now - datetime.fromisoformat(x["p"])).total_seconds() / 3600 if x.get("p") else 12
        except ValueError:
            age = 12
        fresh = 1.0 if age <= 3 else 0.8 if age <= 8 else 0.55
        return min(x["k"], 12) * max(1, x.get("sc", 1)) * fresh * x.get("pw", 1)
    rows.sort(key=score, reverse=True)
    for r in rows:
        r.pop("pw", None)
    kw = extract_keywords([r["t"] for r in rows], TOPIC_STOP, k=10)
    return {"items": rows[:limit], "kw": kw}


def update_history(history: dict, dataset: dict, now: datetime, keep_days: int = 21) -> dict:
    today = now.astimezone(KST).date().isoformat()
    cutoff = (now.astimezone(KST).date() - timedelta(days=keep_days)).isoformat()
    for a2, d in dataset["countries"].items():
        h = history.setdefault(a2, {})
        h[today] = d["w"]  # 하루 중 마지막 수집값으로 덮어씀
        for day in [x for x in h if x < cutoff]:
            del h[day]
    return history
