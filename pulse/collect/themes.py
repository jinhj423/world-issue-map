"""GDELT 주제 코드(V1Themes) → 월드펄스 분야.

GDELT 주제 코드는 수천 개라 하나씩 옮기지 않고, 코드에 들어 있는 낱말로 분야를 정한다.
한 기사가 여러 분야에 들 수 있고, 같은 분야는 기사마다 한 번만 센다.
INVEST(투자자판 지수)는 경제·시장·에너지·무역 중 하나라도 든 기사다.
"""

# (키, 한국어 이름, 들어가면 해당하는 낱말, 들어가도 빼는 낱말)
CATS = [
    ("conflict", "분쟁·안보", ("ARMEDCONFLICT", "MILITARY", "KILL", "TERROR", "WB_2433_CONFLICT", "INSURGENCY",
                              "REBELLION", "WMD", "SEIGE", "BLOCKADE", "CEASEFIRE", "PEACEKEEPING"), ("TAX_MILITARY_TITLE",)),
    ("politics", "정치·선거", ("ELECTION", "LEGISLATION", "IMPEACHMENT", "CORRUPTION", "COUP", "DEMOCRACY", "REFERENDUM"), ()),
    ("unrest", "시위·불안", ("PROTEST", "UNREST", "RIOT", "DEMONSTRAT"), ()),
    ("disaster", "재난", ("NATURAL_DISASTER", "EARTHQUAKE", "FLOOD", "TSUNAMI", "WILDFIRE", "HURRICANE", "TORNADO",
                         "VOLCAN", "DROUGHT", "MANMADE_DISASTER"), ("_IMPLIED",)),
    ("health", "보건·질병", ("DISEASE", "PANDEMIC", "EPIDEMIC", "OUTBREAK", "VACCIN"), ()),
    ("econ", "경제", ("ECON_", "EPU_ECONOMY", "TAX_ECON_PRICE", "UNEMPLOYMENT", "INFLATION", "RECESSION"), ()),
    ("markets", "시장·금리", ("STOCKMARKET", "INTEREST_RATE", "CENTRALBANK", "CENTRAL_BANK", "INFLATION", "CURRENCY",
                            "BANKRUPTCY", "ECON_IPO", "EARNINGSREPORT", "ECON_DEBT"), ()),
    ("energy", "에너지·자원", ("ENV_OIL", "OILPRICE", "PETROL", "GASOLINE", "NATURALGAS", "ENV_COAL", "NUCLEARPOWER",
                            "ENV_SOLAR", "ENV_WINDPOWER", "FUELPRICES", "ENERGY", "MINING"), ()),
    ("trade", "무역·제재", ("SANCTION", "TRADE", "TARIFF", "EMBARGO", "CUSTOMS"), ()),
    ("tech", "기술·사이버", ("CYBER", "ARTIFICIAL_INTELLIGENCE", "WB_133", "SEMICONDUCTOR"), ()),
    ("migration", "이주·난민", ("REFUGEE", "IMMIGRATION", "MIGRATION", "ASYLUM"), ()),
]
KEYS = [c[0] for c in CATS]
NAMES = {c[0]: c[1] for c in CATS}
INVEST_FROM = {"econ", "markets", "energy", "trade"}
GENERAL = ["conflict", "politics", "unrest", "disaster", "health", "econ", "tech", "migration"]
INVEST = ["markets", "energy", "trade", "econ", "conflict"]


def classify(themes: set[str]) -> list[int]:
    """→ 분야마다 0/1, 끝에 투자자판(INVEST) 0/1."""
    flags = []
    for key, _, inc, exc in CATS:
        hit = 0
        for t in themes:
            if any(w in t for w in inc) and not any(x in t for x in exc):
                hit = 1
                break
        flags.append(hit)
    flags.append(1 if any(flags[KEYS.index(k)] for k in INVEST_FROM) else 0)
    return flags
