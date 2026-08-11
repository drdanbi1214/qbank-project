/**
 * 표 데이터를 CSV 로 내려받는다.
 *
 * 엑셀은 UTF-8 CSV 를 열 때 BOM 이 없으면 한글을 깨뜨리므로 앞에 붙인다.
 * 별도 라이브러리 없이 처리하려고 CSV 를 쓴다. 엑셀에서 그대로 열린다.
 */
export function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const escape = (value: string | number | null) => {
    const text = value === null || value === undefined ? '' : String(value)
    // 쉼표, 따옴표, 줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 두 번 쓴다.
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  const csv = rows.map((row) => row.map(escape).join(',')).join('\r\n')
  // \uFEFF 는 BOM. 문자를 직접 넣으면 보이지 않는 공백이라 코드에서 escape 로 쓴다.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * PDF 는 브라우저 인쇄 대화상자로 만든다.
 * 별도 PDF 라이브러리를 넣으면 번들이 크게 늘어나는데, 목록을 종이로 뽑는
 * 용도라면 인쇄 미리보기에서 "PDF 로 저장" 하는 편이 결과도 낫다.
 */
export function printPage(): void {
  window.print()
}
