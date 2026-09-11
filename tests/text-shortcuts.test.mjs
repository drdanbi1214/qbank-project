import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTextShortcuts as type } from '../src/components/editor/extensions/textShortcutRules.ts'

test('한 글자씩 이어 쳐도 양방향 화살표가 완성된다', () => {
  // 이 순서가 무너지면 `<-` 가 먼저 ← 로 바뀌어 `←>` 가 남는다.
  assert.equal(type('<->'), '↔')
  assert.equal(type('a <-> b'), 'a ↔ b')
})

test('한쪽 화살표는 그대로 남는다', () => {
  assert.equal(type('<-'), '←')
  assert.equal(type('->'), '→')
  assert.equal(type('x -> y'), 'x → y')
})

test('나머지 기호 명령도 그대로다', () => {
  assert.equal(type('<='), '≤')
  assert.equal(type('=/='), '≠')
  assert.equal(type('+-'), '±')
  assert.equal(type('=>'), '⇒')
  assert.equal(type('\\>='), '≥')
  assert.equal(type('/>'), '↗')
  assert.equal(type('\\>'), '↘')
})

test('명령이 아닌 글자는 건드리지 않는다', () => {
  assert.equal(type('3 < 5'), '3 < 5')
  assert.equal(type('a-b'), 'a-b')
  assert.equal(type('안녕하세요'), '안녕하세요')
})
