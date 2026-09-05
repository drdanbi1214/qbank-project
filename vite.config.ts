import { fileURLToPath, URL } from 'node:url'
import { readdir, readFile } from 'node:fs/promises'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 앱 번들과 서버의 version.json이 같은 값을 쓰도록 한 번만 만든다.
const buildTime = new Date().toISOString()

// PDF.js는 워커만으로는 한글 CID 글꼴과 PDF 기본 글꼴을 전부 그리지 못한다.
// node_modules를 public에 복제해 두면 패키지 갱신 때 버전이 어긋날 수 있으므로,
// 빌드 중 설치된 pdfjs-dist의 보조 파일을 그대로 결과물에 포함한다.
function emitPdfJsAssets(): Plugin {
  const directories = ['cmaps', 'standard_fonts', 'wasm'] as const
  return {
    name: 'emit-pdfjs-assets',
    apply: 'build' as const,
    async buildStart() {
      for (const directory of directories) {
        const sourceDirectory = fileURLToPath(
          new URL(`./node_modules/pdfjs-dist/${directory}/`, import.meta.url),
        )
        for (const filename of await readdir(sourceDirectory)) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${directory}/${filename}`,
            source: await readFile(fileURLToPath(new URL(filename, `file://${sourceDirectory}/`))),
          })
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    emitPdfJsAssets(),
    {
      name: 'emit-build-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildTime }),
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    // 빌드 시점을 굳혀 넣는다. Vercel 이 커밋마다 새로 빌드하므로 배포될 때마다
    // 저절로 최신 값으로 바뀐다. 별도로 손댈 곳이 없다.
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
})
