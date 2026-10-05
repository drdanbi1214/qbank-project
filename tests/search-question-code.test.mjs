import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCohortQuestionQuery } from '../src/lib/questionSearchCode.ts'

test('year and question number search works without a subject code', () => {
  assert.deepEqual(parseCohortQuestionQuery('22Y10'), { cohort: '22학번', questionNumber: 10 })
  assert.deepEqual(parseCohortQuestionQuery(' 26y004 '), { cohort: '26학번', questionNumber: 4 })
  assert.deepEqual(parseCohortQuestionQuery('23Y24'), { cohort: '23학번', questionNumber: 24 })
})

test('ordinary search text and invalid question numbers do not enter number search', () => {
  for (const value of ['22Y0', '22Y1000', '22Y10 발작', '척추관절염']) {
    assert.equal(parseCohortQuestionQuery(value), null)
  }
})
