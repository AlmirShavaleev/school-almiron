import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §195. Экран заливки картинок каталога.
 *
 * Мок Storage ведёт себя как настоящий бакет в том единственном, ради чего
 * экран существует: помнит занятые ключи и без `upsert` отвечает на них 409.
 * Иначе «уже есть — пропущен» доказывалось бы тем, что мок так написан.
 */

const MB = 1024 * 1024

/** Что улетело в `upload` — по этим записям проверяем путь и `upsert`. */
const uploads: Array<{ path: string; fileName: string; upsert: boolean }> = []
/** Префиксы, с которыми экран звал `list`. */
const listCalls: string[] = []
/** Бакеты, к которым экран вообще обращался: чужих быть не должно. */
const buckets: string[] = []

/** Ключи, уже лежащие в «бакете». */
let occupied = new Set<string>()
/** Что отдаёт `list` — по префиксу. */
let folderRows: Record<string, unknown[]> = {}
let listError: { message: string } | null = null
/** Пути, на которых Storage отказывает не дубликатом, а по-настоящему. */
let uploadErrors: Record<string, { statusCode: string; message: string }> = {}

function storageObject(name: string, size: number, updatedAt: string) {
  return { name, id: `id-${name}`, updated_at: updatedAt, created_at: updatedAt, last_accessed_at: null, metadata: { size, mimetype: 'image/png' } }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket)
        return {
          async upload(path: string, file: File, options: { upsert?: boolean }) {
            const upsert = options?.upsert === true
            uploads.push({ path, fileName: file.name, upsert })
            if (uploadErrors[path]) return { data: null, error: uploadErrors[path] }
            if (occupied.has(path) && !upsert) {
              return { data: null, error: { statusCode: '409', message: 'The resource already exists' } }
            }
            occupied.add(path)
            return { data: { path }, error: null }
          },
          async list(prefix: string) {
            listCalls.push(prefix)
            if (listError) return { data: null, error: listError }
            return { data: folderRows[prefix] ?? [], error: null }
          },
        }
      },
    },
  },
}))

import { CatalogAssetsPage } from '@/pages/catalog/CatalogAssetsPage'

/** File нужного размера без мегабайта данных в памяти. */
function makeFile(name: string, type: string, size = 1024): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function renderPage() {
  return render(<MemoryRouter><CatalogAssetsPage /></MemoryRouter>)
}

function pick(files: File[]) {
  const input = screen.getByTestId('catalog-assets-input')
  fireEvent.change(input, { target: { files } })
}

function setFolder(value: string) {
  fireEvent.change(screen.getByTestId('catalog-assets-folder'), { target: { value } })
}

describe('CatalogAssetsPage — заливка картинок каталога (§195)', () => {
  beforeEach(() => {
    uploads.length = 0
    listCalls.length = 0
    buckets.length = 0
    occupied = new Set()
    folderRows = {}
    listError = null
    uploadErrors = {}
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('файл чужого формата и файл больше 5 МБ отсеиваются ДО загрузки, с текстом', async () => {
    renderPage()
    setFolder('physics-ege/author-kinematics')
    pick([
      makeFile('fig-1.png', 'image/png'),
      makeFile('scan.pdf', 'application/pdf'),
      makeFile('huge.png', 'image/png', 6 * MB),
    ])

    // Текст про оба негодных файла виден сразу, кнопку ещё не нажимали.
    expect(await screen.findByText(/Бакет каталога не примет этот формат \(\.pdf\)/)).toBeInTheDocument()
    expect(screen.getByText(/больше 5 МБ/)).toBeInTheDocument()
    expect(uploads).toHaveLength(0)

    // Кнопка считает только годные.
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))
    await waitFor(() => expect(uploads).toHaveLength(1))
    expect(uploads[0].fileName).toBe('fig-1.png')
  })

  it('путь нормализуется: лишние слеши и пробелы не уезжают в ключ объекта', async () => {
    renderPage()
    setFolder('  /physics-ege//author-kinematics/  ')
    pick([makeFile('fig-1.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))

    await waitFor(() => expect(uploads).toHaveLength(1))
    expect(uploads[0].path).toBe('physics-ege/author-kinematics/fig-1.png')
    // И трогали только бакет каталога.
    expect(new Set(buckets)).toEqual(new Set(['catalog-assets']))
  })

  it('занятый путь без галочки — «уже есть», файл пропускается', async () => {
    occupied.add('physics-ege/kin/fig-1.png')
    renderPage()
    setFolder('physics-ege/kin')
    pick([makeFile('fig-1.png', 'image/png'), makeFile('fig-2.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))

    const results = await screen.findByTestId('catalog-assets-results')
    await waitFor(() => expect(within(results).getAllByTestId('catalog-assets-result-row')).toHaveLength(2))
    expect(within(results).getByText('Уже есть — пропущен')).toBeInTheDocument()
    expect(within(results).getByText('Загружен')).toBeInTheDocument()
    expect(uploads.every(u => u.upsert === false)).toBe(true)
  })

  it('с галочкой «перезаписывать» тот же путь уходит с upsert и помечается перезаписанным', async () => {
    occupied.add('physics-ege/kin/fig-1.png')
    renderPage()
    setFolder('physics-ege/kin')
    fireEvent.click(screen.getByTestId('catalog-assets-overwrite'))
    pick([makeFile('fig-1.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))

    const results = await screen.findByTestId('catalog-assets-results')
    expect(await within(results).findByText('Перезаписан')).toBeInTheDocument()
    expect(uploads).toEqual([{ path: 'physics-ege/kin/fig-1.png', fileName: 'fig-1.png', upsert: true }])
  })

  it('отказ Storage — «Ошибка» с текстом как есть, а не «уже есть»', async () => {
    // 403 от политики не должен превращаться в «пропущен»: пропущенный файл
    // лежит в бакете, а этот не лёг, и его путь нельзя отдавать в импортёр.
    uploadErrors['physics-ege/kin/fig-1.png'] = {
      statusCode: '403',
      message: 'new row violates row-level security policy',
    }
    renderPage()
    setFolder('physics-ege/kin')
    pick([makeFile('fig-1.png', 'image/png'), makeFile('fig-2.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))

    const results = await screen.findByTestId('catalog-assets-results')
    expect(await within(results).findByText('Ошибка')).toBeInTheDocument()
    expect(within(results).getByText('new row violates row-level security policy')).toBeInTheDocument()
    // Упавшая строка не уезжает в буфер, хотя вторая — уехала.
    fireEvent.click(within(results).getByTestId('catalog-assets-copy'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('physics-ege/kin/fig-2.png'))
  })

  it('список показывает содержимое указанной папки и перезапрашивается после заливки', async () => {
    folderRows['physics-ege/kin'] = [
      storageObject('fig-1.png', 2048, '2026-09-17T08:00:00.000Z'),
      storageObject('fig-2.png', 4096, '2026-09-17T08:05:00.000Z'),
      // «Папка» без метаданных — не файл, в списке ей не место.
      { name: 'nested', id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null },
    ]
    folderRows['physics-ege/other'] = [storageObject('other.png', 512, '2026-09-16T08:00:00.000Z')]

    renderPage()
    setFolder('physics-ege/kin')

    const listing = await screen.findByTestId('catalog-assets-listing')
    await waitFor(() => expect(within(listing).getAllByTestId('catalog-assets-listing-row')).toHaveLength(2))
    expect(within(listing).getByText('fig-1.png')).toBeInTheDocument()
    expect(within(listing).getByText('2 КБ')).toBeInTheDocument()
    expect(within(listing).queryByText('nested')).not.toBeInTheDocument()

    // Другая папка — другой список, а не тот же самый.
    setFolder('physics-ege/other')
    await waitFor(() => expect(within(listing).getByText('other.png')).toBeInTheDocument())
    expect(within(listing).queryByText('fig-1.png')).not.toBeInTheDocument()

    // После заливки список запрашивается заново — иначе он врал бы ровно
    // в тот момент, когда на него смотрят.
    const before = listCalls.length
    pick([makeFile('fig-9.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))
    await waitFor(() => expect(listCalls.length).toBeGreaterThan(before))
  })

  it('пустая папка — не пустая таблица, а прямой текст', async () => {
    renderPage()
    setFolder('physics-ege/empty')
    expect(await screen.findByText(/Тут пока пусто/)).toBeInTheDocument()
  })

  it('«Скопировать пути» кладёт в буфер пути залитых и пропущенных, без упавших', async () => {
    occupied.add('physics-ege/kin/fig-2.png')
    renderPage()
    setFolder('physics-ege/kin')
    pick([makeFile('fig-1.png', 'image/png'), makeFile('fig-2.png', 'image/png')])
    fireEvent.click(screen.getByTestId('catalog-assets-upload'))

    const copy = await screen.findByTestId('catalog-assets-copy')
    fireEvent.click(copy)
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'physics-ege/kin/fig-1.png\nphysics-ege/kin/fig-2.png',
    ))
  })

  it('папка запоминается между заходами', async () => {
    const { unmount } = renderPage()
    setFolder('physics-ege/author-kinematics')
    await waitFor(() => expect(localStorage.getItem('almiron:catalog-assets:folder')).toBe('physics-ege/author-kinematics'))
    unmount()

    renderPage()
    expect(screen.getByTestId('catalog-assets-folder')).toHaveValue('physics-ege/author-kinematics')
  })

  it('отказ Storage на списке показывается текстом, а не пустой папкой', async () => {
    listError = { message: 'new row violates row-level security policy' }
    renderPage()
    expect(await screen.findByText('new row violates row-level security policy')).toBeInTheDocument()
    expect(screen.queryByText(/Тут пока пусто/)).not.toBeInTheDocument()
  })
})
