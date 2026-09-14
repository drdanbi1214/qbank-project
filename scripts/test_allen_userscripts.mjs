import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const ROOT = new URL('../', import.meta.url)

function loadFunctions(path, bootMarker, names, globals = {}) {
  const source = fs.readFileSync(new URL(path, ROOT), 'utf8')
  const markerAt = source.lastIndexOf(bootMarker)
  assert.ok(markerAt > 0, `${path}: 시작 호출을 찾지 못했습니다.`)
  const expose = `\n  globalThis.__allenTest = { ${names.join(', ')} };\n})();\n`
  const testSource = source.slice(0, markerAt) + expose
  const context = vm.createContext({
    console,
    URL,
    Blob,
    location: { href: 'https://www.allenslibrary.com/study/chapter/1/problem/1', origin: 'https://www.allenslibrary.com' },
    setTimeout: (callback) => {
      queueMicrotask(callback)
      return 1
    },
    ...globals,
  })
  new vm.Script(testSource, { filename: path }).runInContext(context)
  return context.__allenTest
}

{
  const { extractSourceExamMeta } = loadFunctions(
    'scripts/allen_pdf_workbook_0.1.9.user.js',
    '\n  bootLoop();',
    ['extractSourceExamMeta'],
  )
  assert.deepEqual(
    { ...extractSourceExamMeta('임종평23-2', '임종평23-2 2교시, 43번 | 알렌의 서재') },
    {
      sourceLabel: '임종평23-2 2교시, 43번',
      sourceExam: '임종평23-2',
      sourceSession: 2,
      sourceQuestionNumber: 43,
    },
  )
  assert.deepEqual(
    { ...extractSourceExamMeta('MD25', '2025 의사국시 1교시, 15번 | 알렌의 서재') },
    {
      sourceLabel: '2025 의사국시 1교시, 15번',
      sourceExam: '2025 의사국시',
      sourceSession: 1,
      sourceQuestionNumber: 15,
    },
  )
}

{
  const problem = {
    id: 120086,
    problemId: 120086,
    examName: 'MD2601',
    examPeriod: 3,
    examNumber: 30,
    choices: ['<p>비타민B<sub>6</sub></p>', '<p>비타민B<sub>12</sub></p>', '<p>비타민C</p>', '<p>비타민D</p>', '<p>비타민K</p>'],
    answer: [2],
  }
  const { extractSourceExamMeta, embeddedAnswers } = loadFunctions(
    'scripts/allen_pdf_workbook_0.1.9.user.js',
    '\n  bootLoop();',
    ['extractSourceExamMeta', 'embeddedAnswers'],
    {
      location: {
        href: 'https://www.allenslibrary.com/study/chapter/1914/problem/120086',
        origin: 'https://www.allenslibrary.com',
        pathname: '/study/chapter/1914/problem/120086',
      },
      __NEXT_DATA__: { props: { pageProps: { serverData: { problem } } } },
    },
  )
  assert.deepEqual(
    { ...extractSourceExamMeta('MD2601', '202601 | 고득점 대비 핵심 문항 | 알렌의 서재') },
    {
      sourceLabel: 'MD2601 3교시, 30번',
      sourceExam: 'MD2601',
      sourceSession: 3,
      sourceQuestionNumber: 30,
    },
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      embeddedAnswers(['비타민B6', '비타민B12', '비타민C', '비타민D', '비타민K']),
    )),
    [{ index: 1, text: '비타민B12' }],
  )
}

{
  let calls = 0
  const { downloadImageBlob } = loadFunctions(
    'scripts/allen_kmle_json_export.user.js',
    '\n  addButton();',
    ['downloadImageBlob'],
    {
      GM_xmlhttpRequest: (options) => {
        calls += 1
        queueMicrotask(() => {
          if (calls < 3) options.onerror({ error: '일시적인 네트워크 오류' })
          else options.onload({ status: 200, response: new Blob(['image'], { type: 'image/png' }) })
        })
      },
    },
  )
  const blob = await downloadImageBlob('https://media.allenslibrary.com/problem/test.png')
  assert.equal(calls, 3)
  assert.equal(blob.type, 'image/png')
}

{
  let calls = 0
  const { downloadImageBlob } = loadFunctions(
    'scripts/allen_kmle_json_export.user.js',
    '\n  addButton();',
    ['downloadImageBlob'],
    {
      GM_xmlhttpRequest: (options) => {
        calls += 1
        queueMicrotask(() => options.onerror({ error: 'This domain is not a part of the @connect list' }))
      },
    },
  )
  await assert.rejects(
    downloadImageBlob('https://s3.ap-northeast-2.amazonaws.com/media.allenslibrary.com/problem/test.jpg'),
    /1회 시도 후 실패.*@connect list/,
  )
  assert.equal(calls, 1)
}

console.log('Allen userscript tests passed')
