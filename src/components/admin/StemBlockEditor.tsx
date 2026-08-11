import { useRef, useState } from 'react'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { uploadQuestionImage } from '@/lib/uploads'
import type { StemBlock } from '@/types/question'
import { cn } from '@/utils/cn'

/**
 * 문제 본문 블록 편집기.
 *
 * stem_blocks 는 텍스트, 랩박스, 표, 이미지, 수식이 임의 순서로 섞인 배열이다.
 * 순서가 곧 화면 순서라 위아래 이동이 중요하고, 표와 랩박스는 행 단위로 늘고 준다.
 */
type Props = {
  blocks: StemBlock[]
  onChange: (next: StemBlock[]) => void
  userId: string
  label?: string
}

export function StemBlockEditor({ blocks, onChange, userId, label = '본문' }: Props) {
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update(index: number, next: StemBlock) {
    onChange(blocks.map((block, i) => (i === index ? next : block)))
  }

  function remove(index: number) {
    onChange(blocks.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= blocks.length) return
    const next = [...blocks]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    onChange(next)
  }

  function add(type: StemBlock['type']) {
    const created: StemBlock =
      type === 'text'
        ? { type: 'text', content: '' }
        : type === 'labbox'
          ? { type: 'labbox', items: [{ label: '', value: '' }] }
          : type === 'table'
            ? { type: 'table', headers: ['', ''], rows: [['', '']] }
            : type === 'image'
              ? { type: 'image', url: '', caption: null }
              : { type: 'formula', latex: '' }
    onChange([...blocks, created])
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{label}</h3>
        <span className="text-xs text-slate-400">{blocks.length}개 블록</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPreview((value) => !value)}>
            {preview ? '편집으로' : '미리보기'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {preview ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          {blocks.length === 0 ? (
            <p className="text-sm text-slate-400">내용이 없습니다.</p>
          ) : (
            <StemBlocks blocks={blocks} />
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map((block, index) => (
            <div
              key={index}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="mb-2 flex items-center gap-1">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {BLOCK_LABEL[block.type]}
                </span>
                <div className="ml-auto flex gap-0.5">
                  <IconAction label="위로" onClick={() => move(index, -1)} disabled={index === 0}>
                    ↑
                  </IconAction>
                  <IconAction
                    label="아래로"
                    onClick={() => move(index, 1)}
                    disabled={index === blocks.length - 1}
                  >
                    ↓
                  </IconAction>
                  <IconAction label="삭제" onClick={() => remove(index)}>
                    ✕
                  </IconAction>
                </div>
              </div>

              <BlockFields
                block={block}
                userId={userId}
                onChange={(next) => update(index, next)}
                onError={setError}
              />
            </div>
          ))}

          <div className="flex flex-wrap gap-1">
            {(['text', 'labbox', 'table', 'image', 'formula'] as const).map((type) => (
              <Button key={type} size="sm" variant="secondary" onClick={() => add(type)}>
                + {BLOCK_LABEL[type]}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

const BLOCK_LABEL: Record<StemBlock['type'], string> = {
  text: '텍스트',
  labbox: '검사 수치',
  table: '표',
  image: '이미지',
  formula: '수식',
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950'

function BlockFields({
  block,
  userId,
  onChange,
  onError,
}: {
  block: StemBlock
  userId: string
  onChange: (next: StemBlock) => void
  onError: (message: string | null) => void
}) {
  switch (block.type) {
    case 'text':
      return (
        <textarea
          value={block.content}
          onChange={(event) => onChange({ ...block, content: event.target.value })}
          rows={4}
          placeholder="문제 본문"
          className={inputClass}
        />
      )

    case 'formula':
      return (
        <input
          value={block.latex}
          onChange={(event) => onChange({ ...block, latex: event.target.value })}
          placeholder="LaTeX (예: \\frac{a}{b})"
          className={`${inputClass} font-mono`}
        />
      )

    case 'labbox':
      return (
        <div className="space-y-1">
          {block.items.map((item, index) => (
            <div key={index} className="flex gap-1">
              <input
                value={item.label}
                onChange={(event) =>
                  onChange({
                    ...block,
                    items: block.items.map((row, i) =>
                      i === index ? { ...row, label: event.target.value } : row,
                    ),
                  })
                }
                placeholder="항목 (Hb)"
                className={inputClass}
              />
              <input
                value={item.value}
                onChange={(event) =>
                  onChange({
                    ...block,
                    items: block.items.map((row, i) =>
                      i === index ? { ...row, value: event.target.value } : row,
                    ),
                  })
                }
                placeholder="값 (14.7)"
                className={inputClass}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({ ...block, items: block.items.filter((_, i) => i !== index) })
                }
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange({ ...block, items: [...block.items, { label: '', value: '' }] })}
          >
            행 추가
          </Button>
        </div>
      )

    case 'table':
      return <TableFields block={block} onChange={onChange} />

    case 'image':
      return (
        <ImageFields block={block} userId={userId} onChange={onChange} onError={onError} />
      )

    default:
      return null
  }
}

function TableFields({
  block,
  onChange,
}: {
  block: Extract<StemBlock, { type: 'table' }>
  onChange: (next: StemBlock) => void
}) {
  const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length), 1)

  function setHeader(index: number, value: string) {
    const headers = [...block.headers]
    headers[index] = value
    onChange({ ...block, headers })
  }

  function setCell(rowIndex: number, cellIndex: number, value: string) {
    const rows = block.rows.map((row, i) =>
      i === rowIndex ? row.map((cell, j) => (j === cellIndex ? value : cell)) : row,
    )
    onChange({ ...block, rows })
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, index) => (
                <th key={index} className="p-0.5">
                  <input
                    value={block.headers[index] ?? ''}
                    onChange={(event) => setHeader(index, event.target.value)}
                    placeholder={`머리글 ${index + 1}`}
                    className={`${inputClass} font-semibold`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: columns }, (_, cellIndex) => (
                  <td key={cellIndex} className="p-0.5">
                    <input
                      value={row[cellIndex] ?? ''}
                      onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                      className={inputClass}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({
              ...block,
              headers: [...block.headers, ''],
              rows: block.rows.map((row) => [...row, '']),
            })
          }
        >
          열 추가
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({ ...block, rows: [...block.rows, Array.from({ length: columns }, () => '')] })
          }
        >
          행 추가
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={block.rows.length === 0}
          onClick={() => onChange({ ...block, rows: block.rows.slice(0, -1) })}
        >
          마지막 행 삭제
        </Button>
      </div>
    </div>
  )
}

function ImageFields({
  block,
  userId,
  onChange,
  onError,
}: {
  block: Extract<StemBlock, { type: 'image' }>
  userId: string
  onChange: (next: StemBlock) => void
  onError: (message: string | null) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function upload(file: File) {
    setBusy(true)
    onError(null)
    try {
      const path = await uploadQuestionImage(file, userId)
      onChange({ ...block, url: path })
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : '이미지를 올리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <input
          value={block.url}
          onChange={(event) => onChange({ ...block, url: event.target.value })}
          placeholder="question-images/... 경로"
          className={inputClass}
        />
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? '올리는 중' : '올리기'}
        </Button>
      </div>
      <input
        value={block.caption ?? ''}
        onChange={(event) => onChange({ ...block, caption: event.target.value || null })}
        placeholder="캡션 (선택)"
        className={inputClass}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'h-6 w-6 rounded text-xs text-slate-500 transition-colors disabled:opacity-30',
        'hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
