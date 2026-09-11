import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const printCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const printPage = readFileSync(new URL('../src/pages/PrintPage.tsx', import.meta.url), 'utf8')

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
