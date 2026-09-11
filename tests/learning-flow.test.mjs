import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBlockDraft, blockDraftKey, remainingSeconds } from '../src/lib/blockTestDraft.ts'
import { safeReturnTo, sessionReturnTo, withReturnTo } from '../src/lib/learningNavigation.ts'

const draft = {
  version: 1, sessionId: 'session-1', questionIds: ['q1', 'q2'], startedAt: 1000,
  deadline: 61000, submittedAt: null, phase: 'running', index: 1,
  answers: { q1: [2], q2: [1, 3] }, grades: {},
}
test('refresh preserves answers, position, session identity and absolute deadline', () => {
  assert.deepEqual(parseBlockDraft(JSON.stringify(draft)), draft)
  assert.equal(remainingSeconds(draft.deadline, 41000), 20)
  assert.equal(remainingSeconds(draft.deadline, 90000), 0)
  assert.equal(remainingSeconds(null, 90000), null)
})
test('completed results and partially graded submissions survive reload', () => {
  const partial = { ...draft, submittedAt: 30000, grades: { q1: { selected: [2], isCorrect: true } } }
  assert.deepEqual(parseBlockDraft(JSON.stringify(partial)), partial)
  const result = { ...partial, phase: 'result', grades: { ...partial.grades, q2: { selected: [1, 3], isCorrect: null } } }
  assert.deepEqual(parseBlockDraft(JSON.stringify(result)), result)
})
test('rejects damaged drafts instead of crashing or rendering incomplete results', () => {
  for (const value of [null, '{broken', '{}', JSON.stringify({ ...draft, version: 0 }),
    JSON.stringify({ ...draft, index: 5 }), JSON.stringify({ ...draft, answers: { q1: 'bad' } }),
    JSON.stringify({ ...draft, phase: 'result', submittedAt: 2000 })]) {
    assert.equal(parseBlockDraft(value), null)
  }
})
test('drafts are isolated by account and exam', () => {
  assert.notEqual(blockDraftKey('alice', 'exam1'), blockDraftKey('bob', 'exam1'))
  assert.notEqual(blockDraftKey('alice', 'exam1'), blockDraftKey('alice', 'exam2'))
})
test('return links preserve source filters without altering the question link', () => {
  const source = '/wrong-notes?tab=bookmark&subject=abc&sort=repeated'
  const link = new URL(withReturnTo('/solve?question=q1&reveal=1', source), 'https://qbank.local')
  assert.equal(link.searchParams.get('question'), 'q1')
  assert.equal(link.searchParams.get('reveal'), '1')
  assert.equal(link.searchParams.get('returnTo'), source)
  assert.equal(safeReturnTo(link.searchParams.get('returnTo')), source)
})
test('return links cannot leave the app or loop into the solve screen', () => {
  for (const value of ['https://other.test', '//other.test', '/\\other.test', '/solve?q=1', null]) {
    assert.equal(safeReturnTo(value), null)
  }
})
test('older study sessions have sensible source fallbacks', () => {
  assert.equal(sessionReturnTo('daily', {}), '/study')
  assert.equal(sessionReturnTo('sequential', { exam_id: 'exam1' }), '/exams/exam1')
  assert.equal(sessionReturnTo('sequential', { subject_id: 's', unit_id: 'u' }), '/study/s/u')
  assert.equal(sessionReturnTo('bookmark', {}), '/wrong-notes?tab=bookmark')
  assert.equal(sessionReturnTo('wrong_only', { return_to: '/wrong-notes?subject=s' }), '/wrong-notes?subject=s')
})
