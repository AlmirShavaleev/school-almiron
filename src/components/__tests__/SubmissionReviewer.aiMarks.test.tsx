/**
 * §252. Вердикт с галочкой «Показать ученику N пометок ИИ»: находки
 * становятся пометками учителя В ТОЙ ЖЕ публикации и тем же путём, что
 * «взять» (§209): рамка с источником и номером задания, черновик → published.
 * Проверяется по тому, что легло в `annotation_sets` (подменённая база).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { error: toastError, success: vi.fn() } }))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve({ getViewport: () => ({ width: 100, height: 100 }) }) }),
    destroy: () => Promise.resolve(),
  }),
}))
vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async () => 'blob://fake.jpg',
}))

type Row = { page: number; file_path: string; status: string; author_id: string | null; data: any }
let stored: Row[] = []
/** Страницы, запись которых «падает» (нет сети, нет прав). */
let failPages = new Set<string>()
const calls: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: any) => Promise.resolve({ data: stored, error: null }).then(res),
      }
      return {
        select: () => readChain,
        update: (values: { status: string }) => {
          const chain: any = {
            eq: () => chain,
            in: () => chain,
            then: (res: any) => {
              calls.push('publish')
              stored = stored.map(r => ({ ...r, status: values.status }))
              return Promise.resolve({ error: null }).then(res)
            },
          }
          return chain
        },
        upsert: (row: Row) => {
          calls.push(`save:${row.file_path}#${row.page}`)
          if (failPages.has(`${row.file_path}#${row.page}`)) return Promise.resolve({ error: { message: 'network' } })
          const at = stored.findIndex(r => r.file_path === row.file_path && r.page === row.page)
          const next = { ...row, status: 'draft', author_id: 'teacher-1' }
          if (at >= 0) stored[at] = next
          else stored.push(next)
          return Promise.resolve({ error: null })
        },
      }
    },
    rpc: () => Promise.resolve({ data: [{ ai_findings: 0, teacher_regions: 0 }], error: null }),
  },
}))

import { SubmissionReviewer, type ImportedRegion, type PublishOptions } from '@/components/SubmissionReviewer'

const A = 'att-1/a.jpg'
const B = 'att-1/b.jpg'
const regionsOf = (file: string) => ((stored.find(r => r.file_path === file && r.page === 1)?.data?.objects ?? []) as any[])
  .filter(o => o.type === 'region')

const finding = (id: string, file: string, task: string, text = `Ошибка в ${task}`): ImportedRegion => ({
  filePath: file, page: 1, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, category: 'calc', text, sourceId: id, jobId: 'job-1', task,
})

type PublishFn = (targetStatus?: 'checked' | 'revision', options?: PublishOptions) => Promise<boolean>

async function renderReviewer() {
  const publishRef = { current: null as PublishFn | null }
  const notesApiRef = { current: null as any }
  render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={A}
      filePaths={[A, B]}
      notesInTaskList
      hideToolbarPublish
      publishRef={publishRef}
      notesApiRef={notesApiRef}
    />,
  )
  // Ручки появляются только после чтения страниц (§207).
  await waitFor(() => expect(notesApiRef.current).not.toBeNull())
  return { publishRef, notesApiRef }
}

describe('§252 — перенос находок ИИ вместе с вердиктом', () => {
  beforeEach(() => {
    stored = [{
      page: 1, file_path: A, status: 'draft', author_id: 'teacher-1',
      data: { version: 2, objects: [{ id: 'mine', type: 'region', rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, category: 'error', text: 'Своя', task: '13' }] },
    }]
    failPages = new Set()
    calls.length = 0
    toastError.mockReset()
  })

  it('находки ложатся рамками учителя (источник, задание) рядом со своими и публикуются', async () => {
    const { publishRef } = await renderReviewer()
    let ok = false
    await act(async () => {
      ok = await publishRef.current!('checked', { takeFindings: [finding('f4', A, '4'), finding('f5', A, '5'), finding('f12', B, '12')] })
    })
    expect(ok).toBe(true)
    expect(regionsOf(A).map(r => r.id === 'mine' ? 'mine' : r.source.finding)).toEqual(['mine', 'f4', 'f5'])
    expect(regionsOf(A)[1]).toMatchObject({
      task: '4', text: 'Ошибка в 4', category: 'calc', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      source: { kind: 'ai', finding: 'f4', job: 'job-1' },
    })
    expect(regionsOf(B).map(r => r.source.finding)).toEqual(['f12'])
    // Сначала перенос, потом публикация — ученик видит их как обычные рамки.
    expect(calls.indexOf('publish')).toBeGreaterThan(calls.indexOf(`save:${B}#1`))
    expect(stored.every(r => r.status === 'published')).toBe(true)
  })

  it('две находки одной страницы — одна запись страницы, ни одна не потеряна', async () => {
    const { publishRef } = await renderReviewer()
    await act(async () => { await publishRef.current!('checked', { takeFindings: [finding('f4', A, '4'), finding('f5', A, '5')] }) })
    // Своя и обе находки; страница A — одна запись переноса и одно пересохранение публикацией.
    expect(regionsOf(A)).toHaveLength(3)
    const beforePublish = calls.slice(0, calls.indexOf('publish'))
    expect(beforePublish.filter(c => c === `save:${A}#1`)).toHaveLength(2)
  })

  it('повтор (двойное нажатие, повтор после сбоя) не удваивает рамки', async () => {
    const { publishRef } = await renderReviewer()
    const take = [finding('f4', A, '4'), finding('f4', A, '4')]
    await act(async () => { await publishRef.current!('checked', { takeFindings: take }) })
    await act(async () => { await publishRef.current!('checked', { takeFindings: take }) })
    expect(regionsOf(A).filter(r => r.source?.finding === 'f4')).toHaveLength(1)
  })

  it('«взять» раньше и перенос при вердикте — одна рамка на находку', async () => {
    const { publishRef, notesApiRef } = await renderReviewer()
    await act(async () => { await notesApiRef.current.takeFinding(finding('f4', A, '4')) })
    await act(async () => { await publishRef.current!('revision', { takeFindings: [finding('f4', A, '4'), finding('f5', A, '5')] }) })
    expect(regionsOf(A).filter(r => r.source).map(r => r.source.finding)).toEqual(['f4', 'f5'])
  })

  it('перенос упал — публикации нет, ответ false (вердикт не ставится)', async () => {
    const { publishRef } = await renderReviewer()
    failPages = new Set([`${B}#1`])
    let ok = true
    await act(async () => { ok = await publishRef.current!('checked', { takeFindings: [finding('f4', A, '4'), finding('f12', B, '12')] }) })
    expect(ok).toBe(false)
    expect(calls).not.toContain('publish')
    expect(stored.every(r => r.status === 'draft')).toBe(true)
    expect(toastError).toHaveBeenCalled()
    // Повтор, когда сеть вернулась: что уже легло, не удваивается, остальное доезжает.
    failPages = new Set()
    await act(async () => { ok = await publishRef.current!('checked', { takeFindings: [finding('f4', A, '4'), finding('f12', B, '12')] }) })
    expect(ok).toBe(true)
    expect(regionsOf(A).filter(r => r.source?.finding === 'f4')).toHaveLength(1)
    expect(regionsOf(B).map(r => r.source.finding)).toEqual(['f12'])
  })

  it('без находок — публикация прежняя, ничего не переносится', async () => {
    const { publishRef } = await renderReviewer()
    await act(async () => { await publishRef.current!('checked') })
    expect(regionsOf(A).map(r => r.id)).toEqual(['mine'])
    expect(stored.find(r => r.file_path === B)).toBeUndefined()
    expect(calls).toContain('publish')
  })
})
