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
