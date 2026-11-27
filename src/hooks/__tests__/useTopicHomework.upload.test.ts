import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * §173. Формат работы проверяется в хуке ДО сжатия и ДО Storage.
 *
 * Сжатие по своему правилу «не ломать загрузку» вернёт DNG как есть, а
 * Storage примет что угодно — так восемь ProRAW и уехали в базу. Экран
 * отсеивает такие файлы раньше; хук — последний рубеж для вызова в обход
 * экрана. Проверяем последствия, а не текст кода: что вызвано, что нет.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const HOMEWORK_ROW = { id: 'hw1', topic_id: TOPIC, title: 'ДЗ', instructions: null, is_published: true, due_at: null, grade_scale: null, created_by: 't', created_at: '', updated_at: '' }

const storageUploads: { path: string; name: string; type: string }[] = []
const insertedRows: Record<string, unknown>[] = []
const tableRequests: string[] = []
const readHomework = vi.fn<() => Promise<{ data: unknown; error: null }>>()
const submit = vi.fn<() => Promise<{ error: Error | null }>>()

function chain(rows: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'in', 'limit', 'eq']) c[m] = () => c
  c.insert = (row: Record<string, unknown>) => { insertedRows.push(row); return chain([{ id: `row-${insertedRows.length}`, ...row, created_at: '' }]) }
  c.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
  c.single = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      tableRequests.push(table)
      if (table === 'topic_homework') return { ...chain([HOMEWORK_ROW]), select: () => ({
        eq: () => ({ maybeSingle: readHomework }),
      }) }
      return chain([])
    },
    rpc: (kind: string) => kind === 'topic_homework_submit_attempt'
      ? submit()
      : Promise.resolve({ data: 'att-1', error: null }),
    storage: {
      from: () => ({
        // Подписать URL «не удалось» — хук уходит в простой upload без XHR,
        // которого в jsdom нет; для проверки «дошло ли до Storage» этого хватает.
        createSignedUploadUrl: () => Promise.resolve({ data: null, error: { message: 'no' } }),
        upload: (path: string, file: File) => {
          storageUploads.push({ path, name: file.name, type: file.type })
          return Promise.resolve({ error: null })
        },
        remove: () => Promise.resolve({ error: null }),
      }),
    },
  },
}))

// Сжатие подменено «как есть»: важно не что оно делает, а ДОХОДИТ ли до него файл.
const compressImageFile = vi.fn<(file: File, preset: unknown) => Promise<File>>(async file => file)
vi.mock('@/lib/imageCompression', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/imageCompression')>()),
  compressImageFile: (file: File, preset: unknown) => compressImageFile(file, preset),
}))

// Проверяем именно загрузку, поэтому отключаем аварийный read-only режим только в этом тесте.
// Production-константа и доступ учеников не меняются.
vi.mock('@/lib/readOnlyMode', () => ({ READ_ONLY_MODE: false, READ_ONLY_MESSAGE: 'Технические работы' }))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'stu', role: 'student' } }),
}))

import { useTopicHomework } from '@/hooks/useTopicHomework'

async function mountHook(timedStudent = false) {
  const { result } = renderHook(() => useTopicHomework(TOPIC, { timedStudent }))
  await waitFor(() => expect(result.current.homework?.id).toBe('hw1'))
  return result
}

beforeEach(() => {
  storageUploads.length = 0
  insertedRows.length = 0
  tableRequests.length = 0
  readHomework.mockReset().mockResolvedValue({ data: HOMEWORK_ROW, error: null })
  submit.mockReset().mockResolvedValue({ error: null })
  compressImageFile.mockClear()
})

describe('uploadAttemptFiles — гейт по формату (§173)', () => {
  it('DNG по MIME: отказ с текстом для ученика, сжатие не вызвано, в Storage ничего не ушло', async () => {
    const result = await mountHook()
    const dng = new File(['raw'], 'IMG_0001.dng', { type: 'image/x-adobe-dng' })

    await expect(
      act(async () => { await result.current.uploadAttemptFiles('att-1', [dng]) }),
    ).rejects.toThrow(/\(\.dng\) не откроется у преподавателя.*Выключи RAW/)

    expect(compressImageFile).not.toHaveBeenCalled()
    expect(storageUploads).toEqual([])
    expect(insertedRows).toEqual([])
  })

  it('DNG при пустом MIME — тот же отказ по расширению', async () => {
    const result = await mountHook()
    const dng = new File(['raw'], 'IMG_0002.DNG', { type: '' })

    await expect(
      act(async () => { await result.current.uploadAttemptFiles('att-1', [dng]) }),
    ).rejects.toThrow(/Выключи RAW/)

    expect(compressImageFile).not.toHaveBeenCalled()
    expect(storageUploads).toEqual([])
  })

  it('пачка проверяется целиком до первой отправки: JPG перед DNG тоже не уходит', async () => {
    // Иначе половина пачки легла бы в Storage, а вторая — упала с ошибкой,
    // и ученик получил бы «частично загружено» без объяснения, что именно.
    const result = await mountHook()
    const jpg = new File(['1'], 'a.jpg', { type: 'image/jpeg' })
    const dng = new File(['raw'], 'b.dng', { type: 'image/x-adobe-dng' })

    await expect(
      act(async () => { await result.current.uploadAttemptFiles('att-1', [jpg, dng]) }),
    ).rejects.toThrow(/не откроется у преподавателя/)

    expect(compressImageFile).not.toHaveBeenCalled()
    expect(storageUploads).toEqual([])
  })

  it('JPG / PNG / WebP / HEIC / PDF — путь как раньше: сжатие, Storage, строка в базе', async () => {
    const result = await mountHook()
    const ok = [
      new File(['1'], 'a.jpg', { type: 'image/jpeg' }),
      new File(['2'], 'b.png', { type: 'image/png' }),
      new File(['3'], 'c.webp', { type: 'image/webp' }),
      new File(['4'], 'd.heic', { type: 'image/heic' }),
      new File(['5'], 'e.pdf', { type: 'application/pdf' }),
    ]

    await act(async () => { await result.current.uploadAttemptFiles('att-1', ok) })

    expect(compressImageFile).toHaveBeenCalledTimes(ok.length)
    expect(compressImageFile.mock.calls.map(c => (c[0] as File).name)).toEqual(ok.map(f => f.name))
    expect(storageUploads.map(u => u.name)).toEqual(ok.map(f => f.name))
    expect(storageUploads.every(u => u.path.startsWith('att-1/'))).toBe(true)
    expect(insertedRows.map(r => r.file_name)).toEqual(ok.map(f => f.name))
    expect(insertedRows.map(r => r.position)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('проверочная ученика', () => {
  const draft = {
    id: 'att-1',
    status: 'draft',
    topic_homework_attempt_files: [],
    topic_homework_reviews: [],
  }

  it('читает работу одним запросом и сохраняет в списке фото, записанное во время фонового обновления', async () => {
    const snapshot = {
      data: { ...HOMEWORK_ROW, topic_homework_files: [], topic_homework_attempts: [] },
      error: null,
    }
    readHomework.mockResolvedValueOnce(snapshot)
    const result = await mountHook(true)
    expect(tableRequests).toEqual(['topic_homework'])

    let finishRead: () => void = () => { throw new Error('Запрос за черновиком не начался') }
    readHomework.mockImplementationOnce(() => new Promise(resolve => {
      finishRead = () => resolve({
        data: { ...snapshot.data, topic_homework_attempts: [draft] },
        error: null,
      })
    }))
    await act(async () => { await result.current.startAttempt() })
    expect(result.current.loading).toBe(false)

    const first = new File(['1'], 'a.jpg', { type: 'image/jpeg' })
    const second = new File(['2'], 'b.jpg', { type: 'image/jpeg' })
    compressImageFile.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Сбой второго фото'))
    await act(async () => {
      await expect(result.current.uploadAttemptFiles('att-1', [first, second])).rejects.toThrow('Сбой второго фото')
    })
    await act(async () => { finishRead() })

    expect(result.current.attempts.map(row => row.id)).toEqual(['att-1'])
    expect(result.current.attemptFiles.map(row => row.file_name)).toEqual(['a.jpg'])
    expect(tableRequests).toEqual(['topic_homework', 'topic_homework', 'topic_homework_attempt_files'])
  })

  it('после ответа сервера показывает сдачу, пока фоновый запрос ещё загружается', async () => {
    readHomework.mockResolvedValueOnce({
      data: { ...HOMEWORK_ROW, topic_homework_files: [], topic_homework_attempts: [draft] },
      error: null,
    })
    const result = await mountHook(true)
    submit.mockResolvedValueOnce({ error: new Error('Работа ещё не сдана') })
    await act(async () => {
      await expect(result.current.submitAttempt('att-1')).rejects.toThrow('Работа ещё не сдана')
    })
    expect(result.current.attempts[0].status).toBe('draft')

    readHomework.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => { await result.current.submitAttempt('att-1') })
    expect(result.current.attempts[0].status).toBe('submitted')
    expect(result.current.loading).toBe(false)
    expect(tableRequests).toEqual(['topic_homework', 'topic_homework'])
  })
})

describe('createHomework — флаг выдачи не шлёт (§243)', () => {
  it('в строке вставки нет is_published: выдачу ставит сервер по открытости темы', async () => {
    const result = await mountHook()
    await act(async () => { await result.current.createHomework('', '', { due_at: null }) })
    const row = insertedRows.find(r => r.topic_id === TOPIC)
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty('is_published')
    expect(row).toMatchObject({ title: 'Домашнее задание', created_by: 'stu' })
  })
})
