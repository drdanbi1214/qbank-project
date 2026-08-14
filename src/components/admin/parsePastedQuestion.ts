const CIRCLED_NUMBERS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const CIRCLED_PATTERN = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g

export type ParsedPastedQuestion = {
  stem: string
  choices: string[]
}

function compactLines(value: string): string {
  return value.replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * PDF/문서에서 복사한 문제의 강제 줄바꿈을 없애고 ①, ②… 선지를 분리한다.
 * 본문 중 우연히 등장한 동그라미 숫자는 건드리지 않도록 ①부터 두 개 이상
 * 연속되는 번호 묶음만 선지로 인정한다.
 */
export function parsePastedQuestionText(value: string): ParsedPastedQuestion {
  const normalized = value.replace(/\r\n?/g, '\n')
  const matches = Array.from(normalized.matchAll(CIRCLED_PATTERN))

  for (let start = 0; start < matches.length; start += 1) {
    if (CIRCLED_NUMBERS.indexOf(matches[start][0]) !== 0) continue

    const sequence = [matches[start]]
    for (let index = start + 1; index < matches.length; index += 1) {
      const expected = sequence.length
      if (CIRCLED_NUMBERS.indexOf(matches[index][0]) !== expected) break
      sequence.push(matches[index])
    }
    if (sequence.length < 2) continue

    const choices = sequence.map((match, index) => {
      const from = (match.index ?? 0) + match[0].length
      const to = sequence[index + 1]?.index ?? normalized.length
      return compactLines(normalized.slice(from, to))
    })

    return {
      stem: compactLines(normalized.slice(0, sequence[0].index ?? 0)),
      choices,
    }
  }

  return { stem: compactLines(normalized), choices: [] }
}
