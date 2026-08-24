import { useMemo, useState } from 'react'
import { Formula } from '@/components/question/Formula'
import { ImageZoomModal } from '@/components/question/ImageZoomModal'
import { renderMarkedText, type RenderMark } from '@/components/marking/marks'
import { useSignedUrl } from '@/lib/storage'
import type { StemBlock } from '@/types/question'
import { cn } from '@/utils/cn'

/**
 * 문제 본문은 텍스트/랩박스/표/이미지/수식이 임의 순서로 섞이므로
 * 배열 순서를 그대로 보존해 렌더링한다.
 *
 * 형광펜 위치는 블록을 순서대로 훑으며 매긴 문자 오프셋이다. 블록 사이에는
 * 1칸을 비워, 앞 블록의 끝과 뒤 블록의 시작이 같은 번호를 갖지 않게 한다.
 * 저장된 표시를 다시 그릴 때도 같은 규칙으로 계산하므로 값이 일치한다.
 */
type BlockOffsets =
  | { kind: 'text'; start: number }
  | { kind: 'labbox'; items: { label: number; value: number }[] }
  | { kind: 'table'; headers: number[]; rows: number[][] }
  | { kind: 'image'; caption: number }
  | { kind: 'none' }

/** 렌더링과 무관하게 위치만 먼저 확정한다. 순서만 같으면 항상 같은 값이 나온다. */
function computeOffsets(blocks: StemBlock[]): BlockOffsets[] {
  let pos = 0
  const take = (length: number) => {
    const start = pos
    pos += length
    return start
  }

  return blocks.map((block) => {
    let result: BlockOffsets

    switch (block.type) {
      case 'text':
        result = { kind: 'text', start: take(block.content.length) }
        break
      case 'labbox':
        result = {
          kind: 'labbox',
          items: block.items.map((item) => ({
            label: take(item.label.length),
            value: take(item.value.length),
          })),
        }
        break
      case 'table':
        result = {
          kind: 'table',
          headers: block.headers.map((header) => take(header.length)),
          rows: block.rows.map((row) => row.map((cell) => take(cell.length))),
        }
        break
      case 'image':
        result = { kind: 'image', caption: take(block.caption ? block.caption.length : 1) }
        break
      case 'formula':
        take(1)
        result = { kind: 'none' }
        break
      default:
        result = { kind: 'none' }
    }

    // 블록 경계에서 위치가 겹치지 않도록 한 칸 띄운다.
    pos += 1
    return result
  })
}

export function StemBlocks({
  blocks,
  marks = [],
  compact = false,
}: {
  blocks: StemBlock[]
  marks?: RenderMark[]
  /** 야마 카드처럼 문제보다 해설이 중심인 좁은 자리에서만 지문을 작게 표시한다. */
  compact?: boolean
}) {
  const [zoomed, setZoomed] = useState<{ src: string; caption: string | null } | null>(null)
  const offsets = useMemo(() => computeOffsets(blocks), [blocks])

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-3'}>
      {blocks.map((block, index) => {
        const offset = offsets[index]

        switch (block.type) {
          case 'text':
            return (
              <p
                key={index}
                className={cn(
                  'whitespace-pre-wrap text-slate-800 dark:text-slate-100',
                  compact ? 'text-[13px] font-normal leading-snug' : 'text-[15px] leading-7',
                )}
              >
                {renderMarkedText(
                  block.content,
                  offset.kind === 'text' ? offset.start : 0,
                  marks,
                )}
              </p>
            )

          case 'labbox':
            return (
              <LabBox
                key={index}
                items={block.items}
                starts={offset.kind === 'labbox' ? offset.items : []}
                marks={marks}
              />
            )

          case 'table':
            return (
              <StemTable
                key={index}
                headers={block.headers}
                rows={block.rows}
                headerStarts={offset.kind === 'table' ? offset.headers : []}
                rowStarts={offset.kind === 'table' ? offset.rows : []}
                marks={marks}
              />
            )

          case 'image':
            // 이미지를 아직 못 넣은 자리 표시자. 실제 파일이 없으니 자리를
            // 차지하는 로딩 박스를 영영 띄우지 말고 그냥 건너뛴다.
            if (block.url === 'PLACEHOLDER') return null
            return (
              <StemImage
                key={index}
                url={block.url}
                caption={block.caption}
                captionStart={offset.kind === 'image' ? offset.caption : 0}
                marks={marks}
                onZoom={(src) => setZoomed({ src, caption: block.caption })}
              />
            )

          case 'formula':
            return <Formula key={index} latex={block.latex} />

          default:
            return null
        }
      })}

      {zoomed && (
        <ImageZoomModal
          src={zoomed.src}
          caption={zoomed.caption}
          onClose={() => setZoomed(null)}
        />
      )}
    </div>
  )
}

function LabBox({
  items,
  starts,
  marks,
}: {
  items: { label: string; value: string }[]
  starts: { label: number; value: number }[]
  marks: RenderMark[]
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-6">
        {items.map((item, index) => (
          <div key={index} className="contents">
            <dt className="font-medium text-slate-500 dark:text-slate-400">
              {renderMarkedText(item.label, starts[index]?.label ?? 0, marks)}
            </dt>
            <dd className="tabular-nums text-slate-900 dark:text-slate-100">
              {renderMarkedText(item.value, starts[index]?.value ?? 0, marks)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function StemTable({
  headers,
  rows,
  headerStarts,
  rowStarts,
  marks,
}: {
  headers: string[]
  rows: string[][]
  headerStarts: number[]
  rowStarts: number[][]
  marks: RenderMark[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        {headers.length > 0 && (
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800">
              {headers.map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border border-slate-300 px-3 py-2 text-left font-semibold dark:border-slate-600"
                >
                  {renderMarkedText(header, headerStarts[index] ?? 0, marks)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="border border-slate-300 px-3 py-2 dark:border-slate-600"
                >
                  {renderMarkedText(cell, rowStarts[rowIndex]?.[cellIndex] ?? 0, marks)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StemImage({
  url,
  caption,
  captionStart,
  marks,
  onZoom,
}: {
  url: string
  caption: string | null
  captionStart: number
  marks: RenderMark[]
  onZoom: (src: string) => void
}) {
  const src = useSignedUrl(url)

  if (!src) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700">
        이미지를 불러오는 중입니다
      </div>
    )
  }

  return (
    <figure>
      <button type="button" onClick={() => onZoom(src)} className="block w-full cursor-zoom-in">
        <img
          src={src}
          alt={caption ?? '문제 이미지'}
          loading="lazy"
          className="mx-auto max-h-[60vh] rounded-lg border border-slate-200 object-contain dark:border-slate-700"
        />
      </button>
      {caption && (
        <figcaption className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
          {renderMarkedText(caption, captionStart, marks)}
        </figcaption>
      )}
    </figure>
  )
}
