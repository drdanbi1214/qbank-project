import { parsePageMarks, type PageMark } from '@/components/lecture/pageMarks'

const DATABASE_NAME = 'qbank-lecture-annotations'
const DATABASE_VERSION = 2
const STORE_NAME = 'drafts'

type StoredDraft = {
  key: string
  contextKey: string
  pageNumber: number
  marks: PageMark[]
  /** 이 임시본을 만들 때 마지막으로 확인한 서버 쪽 수정 번호. */
  baseRevision?: number | null
  /** 자동 합치기와 충돌 설명에 쓰는, 수정 전 서버 필기. */
  baseMarks?: PageMark[]
  updatedAt: number
}

export type LectureAnnotationDraft = Pick<
  StoredDraft,
  'pageNumber' | 'marks' | 'baseRevision' | 'baseMarks' | 'updatedAt'
>

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (database.objectStoreNames.contains(STORE_NAME)) return
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' })
      store.createIndex('contextKey', 'contextKey', { unique: false })
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('필기 임시 저장소를 열지 못했습니다.'))
    }
  })
  return databasePromise
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('필기 임시 저장에 실패했습니다.'))
  })
}

export async function fetchLectureAnnotationDrafts(
  contextKey: string,
): Promise<LectureAnnotationDraft[]> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const rows = await requestResult(
    transaction.objectStore(STORE_NAME).index('contextKey').getAll(contextKey) as IDBRequest<StoredDraft[]>,
  )
  return rows
    .filter((row) => Number.isInteger(row.pageNumber) && row.pageNumber > 0)
    .map((row) => ({
      pageNumber: row.pageNumber,
      marks: parsePageMarks(row.marks),
      baseRevision:
        row.baseRevision === null || (Number.isInteger(row.baseRevision) && row.baseRevision! > 0)
          ? row.baseRevision
          : undefined,
      baseMarks: Array.isArray(row.baseMarks) ? parsePageMarks(row.baseMarks) : undefined,
      updatedAt: row.updatedAt,
    }))
}

export async function saveLectureAnnotationDraft(params: {
  contextKey: string
  pageNumber: number
  marks: PageMark[]
  baseRevision: number | null
  baseMarks: PageMark[]
}): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await requestResult(
    transaction.objectStore(STORE_NAME).put({
      key: `${params.contextKey}:${params.pageNumber}`,
      contextKey: params.contextKey,
      pageNumber: params.pageNumber,
      marks: params.marks,
      baseRevision: params.baseRevision,
      baseMarks: params.baseMarks,
      updatedAt: Date.now(),
    } satisfies StoredDraft),
  )
}

export async function removeLectureAnnotationDraft(
  contextKey: string,
  pageNumber: number,
): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await requestResult(transaction.objectStore(STORE_NAME).delete(`${contextKey}:${pageNumber}`))
}
