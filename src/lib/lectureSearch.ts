/**
 * 강의록 검색어를 사람이 입력한 낱말 단위로 나눈다.
 * 쉼표·가운뎃점·슬래시 같은 구분 기호도 공백과 똑같이 취급한다.
 */
export function lectureSearchTerms(query: string): string[] {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms)]
}

function withoutWhitespace(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, '')
}

/**
 * 같은 글 안에 검색 낱말이 모두 있는지 확인한다.
 *
 * PDF 글자 추출 중 한 낱말 안에 공백이나 줄바꿈이 끼는 경우도 있어서, 낱말 AND
 * 검색에 더해 공백을 없앤 원문과 검색어의 연속 일치도 인정한다.
 */
export function includesLectureSearchTerms(text: string, query: string): boolean {
  const terms = lectureSearchTerms(query)
  if (terms.length === 0) return false

  const haystack = text.toLocaleLowerCase()
  if (terms.every((term) => haystack.includes(term))) return true

  const compactNeedle = withoutWhitespace(query)
  return compactNeedle !== '' && withoutWhitespace(text).includes(compactNeedle)
}

/**
 * 강의록 안 찾기의 결과 수를 센다. 한 낱말은 이전처럼 모든 출현을 세고,
 * 여러 낱말은 그 낱말이 모두 있는 쪽을 한 결과로 센다.
 */
export function countLectureSearchMatches(text: string, query: string): number {
  const terms = lectureSearchTerms(query)
  if (terms.length === 0 || !includesLectureSearchTerms(text, query)) return 0
  if (terms.length > 1 || !text.toLocaleLowerCase().includes(terms[0])) return 1

  const haystack = text.toLocaleLowerCase()
  const needle = terms[0]
  let cursor = 0
  let count = 0
  while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
    count += 1
    cursor += needle.length
  }
  return count
}

/** 화면에서 검색 낱말을 각각 칠할 수 있도록 글을 일치/비일치 조각으로 가른다. */
export function splitLectureSearchText(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const terms = lectureSearchTerms(query).sort((a, b) => b.length - a.length)
  if (terms.length === 0) return text === '' ? [] : [{ text, hit: false }]

  const lower = text.toLocaleLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  let cursor = 0

  while (cursor < text.length) {
    let foundAt = -1
    let foundTerm = ''
    for (const term of terms) {
      const at = lower.indexOf(term, cursor)
      if (
        at >= 0 &&
        (foundAt < 0 || at < foundAt || (at === foundAt && term.length > foundTerm.length))
      ) {
        foundAt = at
        foundTerm = term
      }
    }

    if (foundAt < 0) {
      parts.push({ text: text.slice(cursor), hit: false })
      break
    }
    if (foundAt > cursor) parts.push({ text: text.slice(cursor, foundAt), hit: false })
    parts.push({ text: text.slice(foundAt, foundAt + foundTerm.length), hit: true })
    cursor = foundAt + foundTerm.length
  }

  return parts
}
