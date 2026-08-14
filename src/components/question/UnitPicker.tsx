import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useData } from '@/lib/data'
import { createUnit, type Unit } from '@/lib/queries/taxonomy'
import { cn } from '@/utils/cn'

type Props = {
  subjectId: string | null
  unitId: string | null
  onChange: (unitId: string | null) => void
  /** 아직 사람이 확인 안 한 AI 1차 분류일 때 뱃지를 보여준다 */
  unconfirmedAiSuggestion?: boolean
}

/**
 * 단원 선택 + 그 자리에서 새 단원 추가.
 * 배정 화면(AssignmentEditor)과 풀이 작성/수정(SolutionEditor)에서 공유한다.
 */
export function UnitPicker({ subjectId, unitId, onChange, unconfirmedAiSuggestion }: Props) {
  const { taxonomy, refreshAll } = useData()
  // 화면에서 방금 만든 단원은 다음 taxonomy 새로고침 전까지 여기 따로 들고 있는다.
  const [newUnits, setNewUnits] = useState<Unit[]>([])
  const subjectUnits = subjectId
    ? [...(taxonomy?.units.filter((unit) => unit.subjectId === subjectId) ?? []), ...newUnits]
    : []
  const [pickerOpen, setPickerOpen] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)
  const unitName = unitId
    ? (subjectUnits.find((unit) => unit.id === unitId)?.name ??
      taxonomy?.unitById.get(unitId)?.name ??
      '알 수 없는 단원')
    : '미분류'

  async function handleCreateUnit() {
    if (!subjectId) return
    const trimmed = newUnitName.trim()
    if (!trimmed) return

    // DB 유니크 제약이 이름 중복을 막아주긴 하지만, 이미 있는 이름이면 굳이
    // 새로 만들지 않고 그 단원을 바로 선택해준다.
    const existing = subjectUnits.find((unit) => unit.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      onChange(existing.id)
      setPickerOpen(false)
      setAddingUnit(false)
      setNewUnitName('')
      return
    }

    setCreatingUnit(true)
    setUnitError(null)
    try {
      const created = await createUnit(subjectId, trimmed, subjectUnits)
      setNewUnits((prev) => [...prev, created])
      onChange(created.id)
      setPickerOpen(false)
      setAddingUnit(false)
      setNewUnitName('')
      refreshAll()
    } catch (caught) {
      setUnitError(caught instanceof Error ? caught.message : '단원을 추가하지 못했습니다.')
    } finally {
      setCreatingUnit(false)
    }
  }

  if (subjectId === null) return null

  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">단원을 선택해주세요</p>
      {!pickerOpen ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
            {unitName}
          </Button>
          {unconfirmedAiSuggestion && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              AI 1차 분류 · 확인 필요
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {subjectUnits.map((unit) => (
            <button
              key={unit.id}
              type="button"
              onClick={() => {
                onChange(unit.id)
                setPickerOpen(false)
              }}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                unitId === unit.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
              )}
            >
              {unit.name}
            </button>
          ))}
          {!addingUnit ? (
            <button
              type="button"
              onClick={() => setAddingUnit(true)}
              className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
            >
              + 새 단원
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void handleCreateUnit()
              }}
              className="flex items-center gap-1"
            >
              <input
                autoFocus
                type="text"
                value={newUnitName}
                onChange={(event) => setNewUnitName(event.target.value)}
                placeholder="단원 이름"
                disabled={creatingUnit}
                className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
              />
              <Button type="submit" size="sm" disabled={creatingUnit || newUnitName.trim().length === 0}>
                추가
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddingUnit(false)
                  setNewUnitName('')
                  setUnitError(null)
                }}
              >
                취소
              </Button>
            </form>
          )}
        </div>
      )}
      {unitError && <p className="mt-1 text-xs text-marker-red">{unitError}</p>}
    </div>
  )
}
