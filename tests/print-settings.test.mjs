import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PRINT_SETTINGS,
  parsePrintSettings,
  printSettingsKey,
} from '../src/lib/printSettings.ts'

const saved = { layout: 'split', landscape: true, margin: 8, scale: 1.25, splitRatio: 65 }

test('지난번 설정 그대로 다시 연다', () => {
  assert.deepEqual(parsePrintSettings(JSON.stringify(saved)), saved)
})

test('저장된 것이 없거나 깨졌으면 기본값으로 연다', () => {
  assert.deepEqual(parsePrintSettings(null), DEFAULT_PRINT_SETTINGS)
  assert.deepEqual(parsePrintSettings(''), DEFAULT_PRINT_SETTINGS)
  assert.deepEqual(parsePrintSettings('{'), DEFAULT_PRINT_SETTINGS)
  assert.deepEqual(parsePrintSettings('null'), DEFAULT_PRINT_SETTINGS)
  assert.deepEqual(parsePrintSettings('"문자열"'), DEFAULT_PRINT_SETTINGS)
  assert.deepEqual(parsePrintSettings('[]'), DEFAULT_PRINT_SETTINGS)
})

test('범위를 벗어난 값은 슬라이더가 낼 수 있는 값으로 끌어온다', () => {
  const wild = parsePrintSettings(
    JSON.stringify({ layout: '세로형', margin: 900, scale: 99, splitRatio: -40 }),
  )
  assert.equal(wild.margin, 30)
  assert.equal(wild.scale, 1.5)
  assert.equal(wild.splitRatio, 20)
  // 모르는 배치는 기본 배치로 돌린다.
  assert.equal(wild.layout, 'stack')
  assert.equal(wild.landscape, false)
})

test('숫자가 아닌 값은 기본값으로 대신한다', () => {
  const broken = parsePrintSettings(
    JSON.stringify({ margin: '12', scale: null, splitRatio: NaN, landscape: 'true' }),
  )
  assert.equal(broken.margin, DEFAULT_PRINT_SETTINGS.margin)
  assert.equal(broken.scale, DEFAULT_PRINT_SETTINGS.scale)
  assert.equal(broken.splitRatio, DEFAULT_PRINT_SETTINGS.splitRatio)
  // landscape 는 참인 값만 참으로 본다. 문자열 'true' 는 지난 판의 흔적일 수 있다.
  assert.equal(broken.landscape, false)
})

test('배율은 슬라이더 눈금(5%)에 맞춘다', () => {
  assert.equal(parsePrintSettings(JSON.stringify({ scale: 1.234 })).scale, 1.25)
  assert.equal(parsePrintSettings(JSON.stringify({ scale: 0.71 })).scale, 0.7)
})

test('계정마다 따로 담는다', () => {
  assert.notEqual(printSettingsKey('a'), printSettingsKey('b'))
  assert.match(printSettingsKey('a'), /^qbank:print-settings:/)
})
