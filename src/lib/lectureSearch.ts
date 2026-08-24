/**
 * 강의록 검색어를 사람이 입력한 낱말 단위로 나눈다.
 * 쉼표·가운뎃점·슬래시 같은 구분 기호도 공백과 똑같이 취급한다.
 */
export function lectureSearchTerms(query: string): string[] {
  const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(terms)]
}

function withoutWhitespace(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

type HighlightRange = { start: number; end: number; occurrence: number }

/** 공백·줄바꿈·구두점이 끼어도 원문의 어느 글자가 일치했는지 되짚는다. */
function searchHighlightRanges(
  text: string,
  query: string,
  requireAllTerms = true,
): HighlightRange[] {
  const terms = lectureSearchTerms(query).sort((a, b) => b.length - a.length)
  if (terms.length === 0) return []

  const lower = text.toLocaleLowerCase()
  const ranges: HighlightRange[] = []
  let nextOccurrence = 0
  const allTermsPresent = terms.every((term) => lower.includes(term))
  let compactMatched = false

  if (allTermsPresent || !requireAllTerms) {
    for (const term of terms) {
      let cursor = 0
      while (cursor < lower.length) {
        const start = lower.indexOf(term, cursor)
        if (start < 0) break
        ranges.push({
          start,
          end: start + term.length,
          occurrence: terms.length > 1 ? 0 : nextOccurrence++,
        })
        cursor = start + Math.max(term.length, 1)
      }
    }
    if (terms.length > 1) nextOccurrence = 1
  }

  const compactNeedle = withoutWhitespace(query)
  let compactText = ''
  const compactMap: { start: number; end: number }[] = []
  for (let index = 0; index < lower.length; ) {
    const codePoint = lower.codePointAt(index)
    if (codePoint === undefined) break
    const character = String.fromCodePoint(codePoint)
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      compactText += character
      // indexOf가 UTF-16 위치를 돌려주므로 합쳐진 문자열의 코드 단위마다 원문
      // 위치를 하나씩 남긴다. 드문 확장 유니코드 문자도 위치가 어긋나지 않는다.
      for (let unit = 0; unit < character.length; unit += 1) {
        compactMap.push({ start: index, end: index + character.length })
      }
    }
    index += character.length
  }

  if (compactNeedle !== '') {
    let cursor = 0
    while (cursor < compactText.length) {
      const compactStart = compactText.indexOf(compactNeedle, cursor)
      if (compactStart < 0) break
      const mapped = compactMap.slice(compactStart, compactStart + compactNeedle.length)
      const characterRanges = mapped
        .filter((item, index) => index === 0 || item.start !== mapped[index - 1].start)
        .map((item) => ({ start: item.start, end: item.end }))

      // 공백 없는 정확 일치는 위의 일반 낱말 범위와 같다. 그 경우 결과 수와
      // 강조가 두 배가 되지 않게 건너뛴다.
      const alreadyCovered =
        characterRanges.length > 0 &&
        characterRanges.every((item) =>
          ranges.some((range) => range.start <= item.start && range.end >= item.end),
        )

      if (!alreadyCovered && characterRanges.length > 0) {
        compactMatched = true
        const occurrence = terms.length > 1 ? 0 : nextOccurrence++
        for (const item of characterRanges) ranges.push({ ...item, occurrence })
      } else if (alreadyCovered) {
        compactMatched = true
      }
      cursor = compactStart + Math.max(compactNeedle.length, 1)
    }
  }

  // 다중 낱말은 일부만 있는 글을 일치로 보면 안 된다.
  if (requireAllTerms && !allTermsPresent && !compactMatched) return []

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: HighlightRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end && range.occurrence === previous.occurrence) {
      previous.end = Math.max(previous.end, range.end)
    } else if (!previous || range.start >= previous.end) {
      merged.push({ ...range })
    }
  }
  return merged
}

/**
 * 같은 글 안에 검색 낱말이 모두 있는지 확인한다.
 *
 * PDF 글자 추출 중 한 낱말 안에 공백이나 줄바꿈이 끼는 경우도 있어서, 낱말 AND
 * 검색에 더해 공백을 없앤 원문과 검색어의 연속 일치도 인정한다.
 */
export function includesLectureSearchTerms(text: string, query: string): boolean {
  return searchHighlightRanges(text, query, true).length > 0
}

/**
 * 강의록 안 찾기의 결과 수를 센다. 한 낱말은 이전처럼 모든 출현을 세고,
 * 여러 낱말은 그 낱말이 모두 있는 쪽을 한 결과로 센다.
 */
export function countLectureSearchMatches(text: string, query: string): number {
  const terms = lectureSearchTerms(query)
  const ranges = searchHighlightRanges(text, query, true)
  if (terms.length === 0 || ranges.length === 0) return 0
  if (terms.length > 1) return 1
  return new Set(ranges.map((range) => range.occurrence)).size
}

/** 화면에서 검색 낱말을 각각 칠할 수 있도록 글을 일치/비일치 조각으로 가른다. */
export function splitLectureSearchText(
  text: string,
  query: string,
  requireAllTerms = false,
): { text: string; hit: boolean; occurrence: number | null }[] {
  const ranges = searchHighlightRanges(text, query, requireAllTerms)
  if (ranges.length === 0) {
    return text === '' ? [] : [{ text, hit: false, occurrence: null }]
  }

  const parts: { text: string; hit: boolean; occurrence: number | null }[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), hit: false, occurrence: null })
    }
    parts.push({
      text: text.slice(range.start, range.end),
      hit: true,
      occurrence: range.occurrence,
    })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false, occurrence: null })

  return parts
}
