import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const unsaved = new Set<string | symbol>()
const textInMemory = new Map<string, string>()
const filesInMemory = new Map<string, File[]>()
const fileWrites = new Map<string, symbol>()
let filesDatabase: Promise<IDBDatabase> | undefined
let tabId: string | undefined

function draftTabId(): string {
  if (tabId) return tabId
  const prefix = 'almiron-draft-tab:'
  const fresh = () => crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
  try {
    tabId = window.name.match(/almiron-draft-tab:([0-9a-f-]{32,36})/)?.[1] ?? fresh()
    if (!window.name.includes(prefix + tabId)) window.name += prefix + tabId
    return tabId
  } catch {
    tabId ??= fresh()
    return tabId
  }
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}

function protect(key: string | symbol, active: boolean) {
  const before = unsaved.size > 0
  if (active) unsaved.add(key)
  else unsaved.delete(key)
  if (!before && unsaved.size) window.addEventListener('beforeunload', warnBeforeUnload)
  if (before && !unsaved.size) window.removeEventListener('beforeunload', warnBeforeUnload)
}

export function hasUnsafeDrafts(): boolean { return unsaved.size > 0 }

export function holdDraftReload(): () => void {
  const key = Symbol()
  protect(key, true)
  return () => protect(key, false)
}

export function studentDraftKey(scope: string, ...parts: Array<string | null | undefined>): string | null {
  return parts.every(Boolean) ? 'almiron:student-draft:' + JSON.stringify([draftTabId(), scope, ...parts]) : null
}

export function readStudentDraft<T>(key: string | null, fallback: T): T {
  if (key) {
    try {
      const raw = textInMemory.get(key) ?? sessionStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch { /* Storage may be blocked or from an older version. */ }
  }
  return fallback
}

export function saveStudentDraft(key: string | null, value: unknown): void {
  if (!key) return
  const raw = JSON.stringify(value)
  try {
    sessionStorage.setItem(key, raw)
    textInMemory.delete(key)
    protect(key, false)
  } catch {
    textInMemory.set(key, raw)
    protect(key, true)
  }
}

export function clearStudentDraft(key: string | null): void {
  if (!key) return
  textInMemory.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* The confirmed answer is on the server. */ }
  protect(key, false)
}

export function acknowledgeDraftAnswer(key: string | null, field: string, answer: string): void {
  const pending = readStudentDraft<Record<string, string>>(key, {})
  if (pending[field] !== answer) return
  delete pending[field]
  if (Object.keys(pending).length) saveStudentDraft(key, pending)
  else clearStudentDraft(key)
}

function getFilesDatabase(): Promise<IDBDatabase> {
  if (!filesDatabase) {
    filesDatabase = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('almiron-student-drafts', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('attachments')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Draft storage is blocked'))
    }).catch(error => { filesDatabase = undefined; throw error })
  }
  return filesDatabase
}

async function loadDraftFiles(key: string): Promise<File[]> {
  const memory = filesInMemory.get(key)
  if (memory) return memory
  const database = await getFilesDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction('attachments').objectStore('attachments').get(key)
    request.onsuccess = () => {
      const entry = request.result as { files: File[]; expiresAt: number } | undefined
      if (!entry || entry.expiresAt < Date.now()) {
        resolve([])
      } else if (Array.isArray(entry.files) && entry.files.every(file => file instanceof File)) {
        resolve(entry.files)
      } else {
        reject(new Error('Invalid draft attachments'))
      }
    }
    request.onerror = () => reject(request.error)
  })
}

async function persistDraftFiles(key: string, files: File[]): Promise<void> {
  const write = Symbol()
  fileWrites.set(key, write)
  filesInMemory.set(key, files)
  protect(key, true)
  try {
    const database = await getFilesDatabase()
    if (fileWrites.get(key) !== write) return
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('attachments', 'readwrite')
      const store = transaction.objectStore('attachments')
      if (files.length) store.put({ files, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }, key)
      else store.delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const entry = cursor.result
        if (!entry) return
        if (entry.value.expiresAt < Date.now()) entry.delete()
        entry.continue()
      }
    })
    if (fileWrites.get(key) === write) {
      filesInMemory.delete(key)
      protect(key, false)
    }
  } catch {
    // Keep selected files in memory until submitted or removed.
    if (!files.length && fileWrites.get(key) === write) protect(key, false)
  } finally {
    if (fileWrites.get(key) === write) fileWrites.delete(key)
  }
}

export function useDraftFiles(key: string | null) {
  const [attempt, setAttempt] = useState(0)
  const restore = useMemo(() => ({ key, attempt }), [key, attempt])
  const [snapshot, setSnapshot] = useState<{ restore: typeof restore; files: File[]; phase: 'ready' | 'error' }>()
  const activeRestore = useRef<typeof restore | null>(null)
  const phase = key === null ? 'ready' : snapshot?.restore === restore ? snapshot.phase : 'restoring'

  useLayoutEffect(() => {
    activeRestore.current = restore
    return () => { activeRestore.current = null }
  }, [restore])
  useEffect(() => {
    let cancelled = false
    if (key) void loadDraftFiles(key).then(
      files => {
        if (!cancelled && activeRestore.current === restore) setSnapshot({ restore, files, phase: 'ready' })
      },
      () => {
        if (!cancelled && activeRestore.current === restore) setSnapshot({ restore, files: [], phase: 'error' })
      },
    )
    return () => { cancelled = true }
  }, [key, restore])

  const updateFiles = useCallback((next: File[]) => {
    if (!key || activeRestore.current !== restore || phase !== 'ready') return
    setSnapshot({ restore, files: next, phase: 'ready' })
    void persistDraftFiles(key, next)
  }, [key, phase, restore])
  const retry = useCallback(() => setAttempt(value => value + 1), [])

  return [phase === 'ready' && snapshot?.restore === restore ? snapshot.files : [], updateFiles, { phase, retry }] as const
}
