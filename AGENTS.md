# Repository agent instructions

## Allen KMLE JSON 작업

사용자가 Allen에서 수집한 KMLE JSON의 검사, 등록, 갱신, 목차 연결 또는 관련
Tampermonkey/변환기 수정을 요청하면 작업 전에
[`scripts/KMLE_JSON_INGESTION_GUIDE.md`](scripts/KMLE_JSON_INGESTION_GUIDE.md)를
읽고 그 절차를 따른다.

운영 반영 작업은 JSON 사전 검사, 동일 인자의 dry-run, 승인된 apply, JSON과 운영
DB·목차·이미지 저장소의 사후 자동 대조를 한 작업으로 완료한다. 사후 검증이 통과하기
전에는 반영 완료라고 보고하지 않는다.
