import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // 빌드 시점을 굳혀 넣는다. Vercel 이 커밋마다 새로 빌드하므로 배포될 때마다
    // 저절로 최신 값으로 바뀐다. 별도로 손댈 곳이 없다.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
