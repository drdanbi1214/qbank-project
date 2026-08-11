import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fetchRevisions, revertRevision, type RevisionRow } from '@/lib/queries/admin'
import { formatDateTime } from '@/utils/date'

const FIELD_LABEL: Record<string, string> = {
  exam_id: '시험',
  unit_id: '단원',
  question_number: '문항 번호',
  question_type: '유형',
  set_id: '세트',
  stem_blocks: '본문',
  choices: '보기',
  answer_count: '정답 개수',
  editor_answer: '편집자답',
  yama_answer: '야마답',
  answer_status: '정답 상태',
  answer_note: '정답 메모',
  official_explanation: '원본 해설',
  model_answer: '모범답안',
  grading_points: '채점 포인트',
  professor: '교수',
  restorer_note: '복기자 메모',
  source_tags: '출처 태그',
  variant_type: '변형 여부',
  group_id: '중복 그룹',
  completeness: '완성도',
  status: '공개 상태',
  content: '내용',
  references: '참고 자료',
}

/** 최근 변경 피드. 문제 편집은 되돌릴 수 있다. */
export function AdminRevisionsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; rows: RevisionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchRevisions()
      .then((rows) => {
        if (active) {
          setLoaded({ key: reloadKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '이력을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  async function revert(id: string) {
    if (!window.confirm('이 시점 직전 값으로 되돌릴까요? 되돌린 것도 이력에 남습니다.')) return
    setBusyId(id)
    setError(null)
    try {
      await revertRevision(id)
      setReloadKey((value) => value + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '되돌리지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const ready = loaded?.key === reloadKey
  const rows = ready ? loaded.rows : []

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">최근 변경</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            문제와 풀이 편집 이력입니다. 문제는 이전 값으로 되돌릴 수 있습니다.
          </p>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {!ready ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">아직 편집 이력이 없습니다.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {row.entityType === 'question' ? '문제' : '풀이'}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm">{row.summary ?? '수정'}</p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                    {row.editor?.displayName ?? '알 수 없음'} | {formatDateTime(row.createdAt)}
                    {row.fields.length > 0 &&
                      ` | ${row.fields.map((field) => FIELD_LABEL[field] ?? field).join(', ')}`}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  {row.entityType === 'question' && (
                    <>
                      <Link
                        to={`/admin/questions?edit=${row.entityId}`}
                        className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        열기
                      </Link>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === row.id}
                        onClick={() => void revert(row.id)}
                      >
                        되돌리기
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DesktopOnly>
  )
}
