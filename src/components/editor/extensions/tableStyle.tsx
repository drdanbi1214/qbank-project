import { Table, TableCell, TableHeader } from '@tiptap/extension-table'
import { CELL_SHADES, tableBorderOf, type CellShade } from '@/types/richtext'

/**
 * 표 꾸미기.
 *
 * 문서 JSON 은 여러 사람이 나눠 쓰고 그대로 다시 읽히므로, 색과 테두리는
 * 자유 입력이 아니라 정해진 값만 받는다. 임의 CSS 가 본문에 박히면
 * 나중에 뷰어에서 걸러낼 방법이 없다.
 *
 * 저장 형식은 클래스가 아니라 data 속성이다. 편집기와 뷰어가 서로 다른
 * 컴포넌트라, 스타일은 index.css 한 곳에서 data 속성으로 맞춘다.
 */

/** 표 전체의 테두리. 셀마다 따로 주면 관리가 안 되므로 표 단위로만 둔다. */
const borderAttr = {
  border: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => tableBorderOf(element.getAttribute('data-border')),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = tableBorderOf(attrs.border)
      return value ? { 'data-border': value } : {}
    },
  },
}

/** 셀 배경. 형광펜과 같은 팔레트를 써서 문서 안에서 색이 겉돌지 않게 한다. */
const shadeAttr = {
  shade: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => shadeOf(element.getAttribute('data-shade')),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = shadeOf(attrs.shade)
      return value ? { 'data-shade': value } : {}
    },
  },
}

function shadeOf(value: unknown): CellShade | null {
  return typeof value === 'string' && (CELL_SHADES as readonly string[]).includes(value)
    ? (value as CellShade)
    : null
}

export const StyledTable = Table.extend({
  addAttributes() {
    return { ...this.parent?.(), ...borderAttr }
  },
})

export const StyledTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shadeAttr }
  },
})

export const StyledTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shadeAttr }
  },
})
