import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canSettlePrintLayout,
  failedPrintAssetCount,
  pendingPrintAssetCount,
} from '../src/lib/printReadiness.ts'

function snapshot(overrides = {}) {
  return {
    imageTotal: 0,
    imageReady: 0,
    imageFailed: 0,
    pending: { image: 0, lecture: 0, allen: 0, yama: 0 },
    failed: { image: 0, lecture: 0, allen: 0, yama: 0 },
    fontsReady: true,
    ...overrides,
  }
}

test('이미지와 내장 자료가 모두 끝나야 지면을 확정한다', () => {
  assert.equal(
    canSettlePrintLayout(snapshot({ imageTotal: 3, imageReady: 3 })),
    true,
  )
  assert.equal(
    canSettlePrintLayout(snapshot({ imageTotal: 3, imageReady: 2 })),
    false,
  )
  assert.equal(
    canSettlePrintLayout(
      snapshot({ pending: { image: 0, lecture: 1, allen: 0, yama: 0 } }),
    ),
    false,
  )
})

test('글꼴 로딩과 실패한 자료도 인쇄 준비를 막는다', () => {
  assert.equal(canSettlePrintLayout(snapshot({ fontsReady: false })), false)
  assert.equal(
    canSettlePrintLayout(
      snapshot({ failed: { image: 0, lecture: 0, allen: 1, yama: 0 } }),
    ),
    false,
  )
})

test('대기 및 실패 수를 종류 전체에서 합산한다', () => {
  const current = snapshot({
    imageTotal: 5,
    imageReady: 3,
    imageFailed: 1,
    pending: { image: 2, lecture: 1, allen: 1, yama: 1 },
    failed: { image: 1, lecture: 1, allen: 0, yama: 0 },
  })
  assert.equal(pendingPrintAssetCount(current), 6)
  assert.equal(failedPrintAssetCount(current), 3)
})
