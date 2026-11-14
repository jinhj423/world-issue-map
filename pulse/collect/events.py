"""GDELT 2.0 사건 자료(15분 export 파일)의 CAMEO 사건 코드를 '무슨 일' 묶음으로 바꾼다.

사건 자료는 GDELT가 기사 문장을 기계로 읽어 '누가 누구에게 무엇을 했나'를 CAMEO 코드로 분류한 것이다(GKG와 같은 이용 조건).
발언·호소·협의처럼 거의 모든 기사에 나오는 흔한 코드(01·02·03·04·05·06·08·10·11·12)는 '무슨 일'을 알려 주지 않아 묶음에서 뺀다.
열 번호(2026-11-15 실제 파일로 확인, 61열): 25 IsRootEvent, 27 EventBaseCode, 28 EventRootCode, 33 NumArticles,
37 Actor1Geo_CountryCode, 53 ActionGeo_CountryCode(FIPS), 59 DATEADDED, 60 SOURCEURL.
"""
from __future__ import annotations

# (키, 화면 이름, CAMEO 기본 코드(3자리) 또는 뿌리 코드(2자리)). 기본 코드가 뿌리 코드보다 먼저 맞는다.
EVG = [
    ("strike", "공습", ["195"]),
    ("fight", "교전", ["190", "193", "194", "196"]),
    ("occupy", "봉쇄·점령", ["191", "192"]),
    ("mass", "대량 살상", ["20"]),
    ("bomb", "폭탄 공격", ["183"]),
    ("kill", "암살", ["185", "186"]),
    ("abduct", "납치·인질", ["181", "184"]),
    ("assault", "폭력 공격", ["180", "182"]),
    ("arrest", "체포·기소", ["173"]),
    ("deport", "추방", ["174"]),
    ("crackdown", "폭력 진압", ["175"]),
    ("cyber", "사이버 공격", ["176", "155"]),
    ("seize", "압수·파괴", ["171"]),
    ("restrict", "규제·금지 조치", ["172"]),
    ("riot", "폭동", ["145"]),
    ("protest", "시위·파업", ["14"]),
    ("force", "군 동원·경계", ["15"]),
    ("sanction", "제재·금수", ["163"]),
    ("cut", "관계 축소", ["16"]),
    ("milthreat", "군사 위협", ["138", "139"]),
    ("threat", "위협", ["13"]),
    ("lawsuit", "소송·판결", ["115", "116"]),
    ("probe", "수사·조사", ["09"]),
    ("aid", "지원", ["07"]),
    ("deal", "협정 서명", ["057"]),
    ("talks", "협상·중재", ["046", "045", "039", "038"]),
    ("visit", "방문·회담", ["042", "043", "044"]),
    ("release", "석방·송환", ["084"]),
    ("deesc", "긴장 완화", ["087"]),
    ("ease", "제재 완화", ["081", "085"]),
    ("econ", "경제 협력", ["061"]),
    ("milcoop", "군사 협력", ["062"]),
]
NAMES = {k: name for k, name, _ in EVG}
_CODE = {c: k for k, _, codes in EVG for c in codes}


def group_of(base: str, root: str) -> str | None:
    return _CODE.get(base) or _CODE.get(root)
