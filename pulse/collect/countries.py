"""월드펄스 나라 표.

GDELT GKG의 장소 나라 코드는 FIPS 10-4라서 ISO 3166 두 글자 코드로 바꿔 쓴다.
행: ISO2, 지도 숫자 id(world-atlas countries-110m, 없으면 ""), FIPS(여러 개면 |로), 한국어 이름, GDELT가 쓰는 영어 이름.
FIPS가 맞는지는 collect.py가 실행 때마다 GDELT의 나라 단위 장소 이름과 비교해 로그에 남긴다(check_fips).
"""

ROWS = """
FJ|242|FJ|피지|Fiji
TZ|834|TZ|탄자니아|Tanzania
EH|732|WI|서사하라|Western Sahara
CA|124|CA|캐나다|Canada
US|840|US|미국|United States
KZ|398|KZ|카자흐스탄|Kazakhstan
UZ|860|UZ|우즈베키스탄|Uzbekistan
PG|598|PP|파푸아뉴기니|Papua New Guinea
ID|360|ID|인도네시아|Indonesia
AR|032|AR|아르헨티나|Argentina
CL|152|CI|칠레|Chile
CD|180|CG|콩고민주공화국|Democratic Republic of the Congo
SO|706|SO|소말리아|Somalia
KE|404|KE|케냐|Kenya
SD|729|SU|수단|Sudan
TD|148|CD|차드|Chad
HT|332|HA|아이티|Haiti
DO|214|DR|도미니카공화국|Dominican Republic
RU|643|RS|러시아|Russia
BS|044|BF|바하마|Bahamas
FK|238|FK|포클랜드 제도|Falkland Islands
NO|578|NO|노르웨이|Norway
GL|304|GL|그린란드|Greenland
TF|260|FS|프랑스령 남방 지역|French Southern and Antarctic Lands
TL|626|TT|동티모르|East Timor
ZA|710|SF|남아프리카공화국|South Africa
LS|426|LT|레소토|Lesotho
MX|484|MX|멕시코|Mexico
UY|858|UY|우루과이|Uruguay
BR|076|BR|브라질|Brazil
BO|068|BL|볼리비아|Bolivia
PE|604|PE|페루|Peru
CO|170|CO|콜롬비아|Colombia
PA|591|PM|파나마|Panama
CR|188|CS|코스타리카|Costa Rica
NI|558|NU|니카라과|Nicaragua
HN|340|HO|온두라스|Honduras
SV|222|ES|엘살바도르|El Salvador
GT|320|GT|과테말라|Guatemala
BZ|084|BH|벨리즈|Belize
VE|862|VE|베네수엘라|Venezuela
GY|328|GY|가이아나|Guyana
SR|740|NS|수리남|Suriname
FR|250|FR|프랑스|France
EC|218|EC|에콰도르|Ecuador
PR|630|RQ|푸에르토리코|Puerto Rico
JM|388|JM|자메이카|Jamaica
CU|192|CU|쿠바|Cuba
ZW|716|ZI|짐바브웨|Zimbabwe
BW|072|BC|보츠와나|Botswana
NA|516|WA|나미비아|Namibia
SN|686|SG|세네갈|Senegal
ML|466|ML|말리|Mali
MR|478|MR|모리타니|Mauritania
BJ|204|BN|베냉|Benin
NE|562|NG|니제르|Niger
NG|566|NI|나이지리아|Nigeria
CM|120|CM|카메룬|Cameroon
TG|768|TO|토고|Togo
GH|288|GH|가나|Ghana
CI|384|IV|코트디부아르|Ivory Coast
GN|324|GV|기니|Guinea
GW|624|PU|기니비사우|Guinea-Bissau
LR|430|LI|라이베리아|Liberia
SL|694|SL|시에라리온|Sierra Leone
BF|854|UV|부르키나파소|Burkina Faso
CF|140|CT|중앙아프리카공화국|Central African Republic
CG|178|CF|콩고공화국|Republic of the Congo
GA|266|GB|가봉|Gabon
GQ|226|EK|적도기니|Equatorial Guinea
ZM|894|ZA|잠비아|Zambia
MW|454|MI|말라위|Malawi
MZ|508|MZ|모잠비크|Mozambique
SZ|748|WZ|에스와티니|Swaziland
AO|024|AO|앙골라|Angola
BI|108|BY|부룬디|Burundi
IL|376|IS|이스라엘|Israel
LB|422|LE|레바논|Lebanon
MG|450|MA|마다가스카르|Madagascar
PS|275|WE|GZ|팔레스타인|West Bank
GM|270|GA|감비아|Gambia
TN|788|TS|튀니지|Tunisia
DZ|012|AG|알제리|Algeria
JO|400|JO|요르단|Jordan
AE|784|AE|아랍에미리트|United Arab Emirates
QA|634|QA|카타르|Qatar
KW|414|KU|쿠웨이트|Kuwait
IQ|368|IZ|이라크|Iraq
OM|512|MU|오만|Oman
VU|548|NH|바누아투|Vanuatu
KH|116|CB|캄보디아|Cambodia
TH|764|TH|태국|Thailand
LA|418|LA|라오스|Laos
MM|104|BM|미얀마|Burma
VN|704|VM|베트남|Vietnam
KP|408|KN|북한|North Korea
KR|410|KS|한국|South Korea
MN|496|MG|몽골|Mongolia
IN|356|IN|인도|India
BD|050|BG|방글라데시|Bangladesh
BT|064|BT|부탄|Bhutan
NP|524|NP|네팔|Nepal
PK|586|PK|파키스탄|Pakistan
AF|004|AF|아프가니스탄|Afghanistan
TJ|762|TI|타지키스탄|Tajikistan
KG|417|KG|키르기스스탄|Kyrgyzstan
TM|795|TX|투르크메니스탄|Turkmenistan
IR|364|IR|이란|Iran
SY|760|SY|시리아|Syria
AM|051|AM|아르메니아|Armenia
SE|752|SW|스웨덴|Sweden
BY|112|BO|벨라루스|Belarus
UA|804|UP|우크라이나|Ukraine
PL|616|PL|폴란드|Poland
AT|040|AU|오스트리아|Austria
HU|348|HU|헝가리|Hungary
MD|498|MD|몰도바|Moldova
RO|642|RO|루마니아|Romania
LT|440|LH|리투아니아|Lithuania
LV|428|LG|라트비아|Latvia
EE|233|EN|에스토니아|Estonia
DE|276|GM|독일|Germany
BG|100|BU|불가리아|Bulgaria
GR|300|GR|그리스|Greece
TR|792|TU|튀르키예|Turkey
AL|008|AL|알바니아|Albania
HR|191|HR|크로아티아|Croatia
CH|756|SZ|스위스|Switzerland
LU|442|LU|룩셈부르크|Luxembourg
BE|056|BE|벨기에|Belgium
NL|528|NL|네덜란드|Netherlands
PT|620|PO|포르투갈|Portugal
ES|724|SP|스페인|Spain
IE|372|EI|아일랜드|Ireland
NC|540|NC|뉴칼레도니아|New Caledonia
SB|090|BP|솔로몬 제도|Solomon Islands
NZ|554|NZ|뉴질랜드|New Zealand
AU|036|AS|호주|Australia
LK|144|CE|스리랑카|Sri Lanka
CN|156|CH|중국|China
TW|158|TW|대만|Taiwan
IT|380|IT|이탈리아|Italy
DK|208|DA|덴마크|Denmark
GB|826|UK|영국|United Kingdom
IS|352|IC|아이슬란드|Iceland
AZ|031|AJ|아제르바이잔|Azerbaijan
GE|268|GG|조지아|Georgia
PH|608|RP|필리핀|Philippines
MY|458|MY|말레이시아|Malaysia
BN|096|BX|브루나이|Brunei
SI|705|SI|슬로베니아|Slovenia
FI|246|FI|핀란드|Finland
SK|703|LO|슬로바키아|Slovakia
CZ|203|EZ|체코|Czech Republic
ER|232|ER|에리트레아|Eritrea
JP|392|JA|일본|Japan
PY|600|PA|파라과이|Paraguay
YE|887|YM|예멘|Yemen
SA|682|SA|사우디아라비아|Saudi Arabia
CY|196|CY|키프로스|Cyprus
MA|504|MO|모로코|Morocco
EG|818|EG|이집트|Egypt
LY|434|LY|리비아|Libya
ET|231|ET|에티오피아|Ethiopia
DJ|262|DJ|지부티|Djibouti
UG|800|UG|우간다|Uganda
RW|646|RW|르완다|Rwanda
BA|070|BK|보스니아 헤르체고비나|Bosnia and Herzegovina
MK|807|MK|북마케도니아|Macedonia
RS|688|RI|세르비아|Serbia
ME|499|MJ|몬테네그로|Montenegro
XK||KV|코소보|Kosovo
TT|780|TD|트리니다드 토바고|Trinidad and Tobago
SS|728|OD|남수단|South Sudan
SG||SN|싱가포르|Singapore
HK||HK|홍콩|Hong Kong
BH||BA|바레인|Bahrain
MT||MT|몰타|Malta
MV||MV|몰디브|Maldives
MU||MP|모리셔스|Mauritius
BB||BB|바베이도스|Barbados
MC||MN|모나코|Monaco
VA||VT|바티칸|Vatican City
LI||LS|리히텐슈타인|Liechtenstein
MO||MC|마카오|Macau
SC||SE|세이셸|Seychelles
CV||CV|카보베르데|Cape Verde
WS||WS|사모아|Samoa
"""


def load():
    """→ (rows, fips_to_iso). rows: {iso: {id, ko, en, fips:[...]}}"""
    rows, f2i = {}, {}
    for line in ROWS.strip().splitlines():
        p = line.split("|")
        if p[0] == "PS":  # 팔레스타인은 FIPS 두 개(서안 WE, 가자 GZ)
            iso, nid, fips, ko, en = p[0], p[1], [p[2], p[3]], p[4], p[5]
        else:
            iso, nid, fips, ko, en = p[0], p[1], [p[2]], p[3], p[4]
        rows[iso] = {"id": nid, "ko": ko, "en": en, "fips": fips}
        for f in fips:
            f2i[f] = iso
    return rows, f2i


if __name__ == "__main__":
    r, f = load()
    print(len(r), "나라 ·", len(f), "FIPS 코드")
    assert len(set(f)) == len(f)
