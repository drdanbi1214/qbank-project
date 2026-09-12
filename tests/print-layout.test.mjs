import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const printCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const printPage = readFileSync(new URL('../src/pages/PrintPage.tsx', import.meta.url), 'utf8')
const richTextViewer = readFileSync(
  new URL('../src/components/editor/RichTextViewer.tsx', import.meta.url),
  'utf8',
)
const stemBlocks = readFileSync(
  new URL('../src/components/question/StemBlocks.tsx', import.meta.url),
  'utf8',
)

test('인쇄 제목을 다단 흐름 안에서 전폭으로 펼친다', () => {
  assert.match(
    printCss,
    /\.print-columns > \.print-column-header\s*\{[^}]*column-span:\s*all;[^}]*break-after:\s*avoid-page;/s,
  )
  assert.match(
    printCss,
    /\.print-columns > \.print-column-items\s*\{[^}]*display:\s*contents;/s,
  )
  assert.match(printPage, /columns > 1 && 'print-column-header'/)
  assert.match(printPage, /columns > 1\s*\? 'print-column-items'/)
})

test('저장된 표 열 폭을 인쇄 단 안의 백분율로 바꾸고 넘침을 차단한다', () => {
  assert.match(
    printCss,
    /table col\[data-print-column\]\s*\{[^}]*width:\s*var\(--print-column-width, auto\) !important;/s,
  )
  assert.match(
    printCss,
    /\[data-print-doc\] \[data-print-table-wrap\]\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*clip !important;/s,
  )
  assert.match(richTextViewer, /data-print-table-wrap=""/)
  assert.match(richTextViewer, /'--print-column-width': printWidth/)
  assert.match(stemBlocks, /data-print-table-wrap=""/)
})
