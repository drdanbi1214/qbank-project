import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const printCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

test('인쇄 제목과 다단 본문 사이에서 첫 페이지를 넘기지 않는다', () => {
  assert.match(
    printCss,
    /\[data-print-doc\] > header\s*\{[^}]*page-break-after:\s*avoid;[^}]*break-after:\s*avoid-page;/s,
  )
  assert.match(
    printCss,
    /\[data-print-doc\] \.print-columns\s*\{[^}]*page-break-before:\s*avoid;[^}]*break-before:\s*avoid-page;/s,
  )
})
