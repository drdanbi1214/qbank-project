/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_STORAGE_PROVIDER?: 'supabase' | 'r2'
  readonly VITE_R2_GATEWAY_URL?: string
  readonly VITE_STORAGE_READ_FALLBACK?: string
  readonly VITE_STORAGE_UPLOAD_FALLBACK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** vite.config.ts 의 define 에서 빌드 시점에 문자열로 굳혀 넣는다. */
declare const __BUILD_TIME__: string
