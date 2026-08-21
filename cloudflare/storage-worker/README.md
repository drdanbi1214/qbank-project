# Qbank private R2 gateway

Supabase JWT와 DB 권한 판정을 그대로 사용하면서 비공개 R2 객체를 전달한다.
R2 API 자격 증명은 브라우저에 보내지 않는다.

## Endpoints

- `POST /v1/sign` — `{ "storagePath": "bucket/path" }`를 받아 짧은 읽기 URL 발급
- `GET|HEAD /v1/objects/bucket/path?expires=...&signature=...` — 서명 검증 후 R2 전달
- `PUT /v1/uploads/bucket/user-id/path` — JWT·경로·MIME·크기 검사 후 업로드
- `GET|HEAD|PUT /v1/internal/objects/bucket/path` — 로컬 관리 스크립트 전용(삭제 없음)
- `GET /health` — 공개 상태 확인

`POST /v1/sign`과 `PUT /v1/uploads/...`에는 Supabase 세션의
`Authorization: Bearer <user-jwt>` 헤더가 필요하다.

## One-time setup

```bash
npx wrangler login
npx wrangler r2 bucket create qbank-storage
openssl rand -base64 48 | npx wrangler secret put URL_SIGNING_SECRET \
  --config cloudflare/storage-worker/wrangler.jsonc
openssl rand -base64 48 | npx wrangler secret put MIGRATION_SECRET \
  --config cloudflare/storage-worker/wrangler.jsonc
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY \
  --config cloudflare/storage-worker/wrangler.jsonc
npm run worker:deploy
```

로컬 개발에서는 `.dev.vars.example`을 `.dev.vars`로 복사하고 실제 값을 넣는다.
`.dev.vars`는 Git에 커밋하지 않는다.

## Migration and verification

이전 명령은 Supabase 원본을 삭제하지 않으며, 객체마다 R2에서 다시 내려받아
SHA-256을 비교한다. 완료 기록은 무시되는 `tmp/r2-migration-manifest.jsonl`에
남아 중단 후 같은 명령으로 재개할 수 있다.

```bash
python3 scripts/migrate_storage_to_r2.py --apply --verify --workers 6

# manifest를 믿지 않고 양쪽 원본을 다시 읽는 전수 감사
python3 scripts/migrate_storage_to_r2.py --force --verify --workers 6
```

전수 검증 뒤에만 Vercel의 `VITE_STORAGE_PROVIDER=r2`를 배포한다. 초기 canary
기간에는 읽기·업로드 fallback을 모두 유지한다. 실제 인증 업로드와 서명 읽기 E2E가
통과하면 신규 파일이 두 저장소로 갈라지지 않도록
`VITE_STORAGE_UPLOAD_FALLBACK=false`로 바꾸고,
`VITE_STORAGE_READ_FALLBACK=true`만 유지한다.

## Rollback

R2 읽기나 업로드에 운영 문제가 있으면 Vercel의 `VITE_STORAGE_PROVIDER`를
`supabase`로 되돌려 재배포한다. DB에는 같은 `버킷/경로`가 남고 Supabase 원본도
보존하므로 데이터 변경 없이 즉시 되돌릴 수 있다.

Supabase 원본 삭제는 이 문서의 롤백 경로를 포기하는 파괴적 작업이다. 실제 로그인
화면에서 이미지와 PDF를 표본 확인하고 별도 백업을 확보하기 전에는 삭제하지 않는다.

R2 전환 뒤 Supabase 사본은
`20260821183000_freeze_supabase_storage_backup.sql`을 적용해 읽기 전용으로
고정한다. 이 마이그레이션은 클라이언트 쓰기 정책을 제거하고 restrictive
INSERT/UPDATE/DELETE 거부 정책을 추가해, permissive 정책이 실수로 생겨도 쓰기를
차단한다. 읽기 fallback과 `service_role`을 이용한 명시적 복구는 계속 가능하다.
