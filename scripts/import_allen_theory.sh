#!/usr/bin/env bash
# 알렌 전체 내보내기에서 아직 이론에 없는 과목만 등록한다.
#
# 이미 등록된 순환기/호흡기/소화기/외과총론/외과각론/정신건강의학과/신경과/정형외과는 건너뛴다.
# 류마티스는 원본에 제목만 있고 본문이 없어 제외한다.
# 비뇨기과/예방의학/응급의학과/의료법규는 대응하는 과목이 없어 제외한다.
#
# 사용법:
#   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bash scripts/import_allen_theory.sh          # 미리보기
#   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... bash scripts/import_allen_theory.sh --apply  # 실제 등록
set -euo pipefail

ZIP="convert_file/알렌 전체 .zip"
APPLY="${1:-}"

run() { # code  root-page  section  section-order
  echo ""
  echo "───────── $3 (과목 $1) ─────────"
  python3 scripts/import_notion_theory.py "$ZIP" \
    --subject-code "$1" --root-page "$2" --section "$3" --section-order "$4" \
    --resume ${APPLY:+--apply}
}

# 내과: 기존 순환기(12000)/호흡기(18000)/소화기(21000) 뒤에 붙인다.
run 01 "신장 (1)"              "신장"       30000
run 01 "내분비 (1)"            "내분비"     31000
run 01 "혈액 (1)"              "혈액"       32000
run 01 "종양 (1)"              "종양"       33000
run 01 "감염 (1)"              "감염"       34000
run 01 "알레르기 (1)"          "알레르기"   35000

# 산부인과
run 03 "산과 (1)"              "산과"        1000
run 03 "부인과 (1)"            "부인과"      2000

# 소아청소년과
run 04 "소아청소년과 총론 (1)"  "총론"        1000
run 04 "소아청소년과 각론 (1)"  "각론"        2000

echo ""
echo "끝났다. --apply 없이 돌렸다면 미리보기만 한 것이다."
