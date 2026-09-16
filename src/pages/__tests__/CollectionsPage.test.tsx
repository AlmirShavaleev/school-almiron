import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §188. Список сохранённых подборок каталога. Проверяем поведение, ради
 * которого экран заводился: видно только своё и только неархивное, числа
 * заданий берутся одним запросом на весь список, строка ведёт в карточку,
 * «В архив» убирает строку и пишет в базу, а пустой список — не пустая
 * таблица.
 *
 * Мок — маленький PostgREST: фильтры `eq`/`in` он ПРИМЕНЯЕТ, а не проглатывает.
 * Иначе «чужая подборка не видна» доказывалось бы тем, что чужой строки нет в
 * фикстуре, — то есть ничем.
 */

const ME    = 'profile-me'
const OTHER = 'profile-other'

const COLLECTIONS = [
  { id: 'c-1', created_by: ME,    title: 'Кинематика — контрольная', description: null, subject: 'Физика',     work_type: 'control',  pdf_config: {}, is_archived: false, created_at: '2026-09-01T09:00:00.000Z', updated_at: '2026-09-14T10:16:00.000Z' },
  { id: 'c-2', created_by: ME,    title: 'Производная — домашняя',   description: null, subject: 'Математика', work_type: 'homework', pdf_config: {}, is_archived: false, created_at: '2026-09-02T09:00:00.000Z', updated_at: '2026-09-10T18:40:00.000Z' },
  { id: 'c-3', created_by: ME,    title: 'Старая подборка',          description: null, subject: 'Физика',     work_type: 'custom',   pdf_config: {}, is_archived: true,  created_at: '2026-08-01T09:00:00.000Z', updated_at: '2026-08-02T12:00:00.000Z' },
  { id: 'c-4', created_by: OTHER, title: 'Чужая подборка',           description: null, subject: 'Физика',     work_type: 'custom',   pdf_config: {}, is_archived: false, created_at: '2026-09-03T09:00:00.000Z', updated_at: '2026-09-15T12:00:00.000Z' },
]

// Три задания в c-1, два в c-2 — и по одному в архивной и чужой, чтобы было
// видно, если счётчик вдруг начнёт считать не по тем строкам.
const ITEMS = [
  { id: 'i-1', collection_id: 'c-1' },
  { id: 'i-2', collection_id: 'c-1' },
  { id: 'i-3', collection_id: 'c-1' },
  { id: 'i-4', collection_id: 'c-2' },
  { id: 'i-5', collection_id: 'c-2' },
  { id: 'i-6', collection_id: 'c-3' },
  { id: 'i-7', collection_id: 'c-4' },
]

/** Вызовы `from(...)` по порядку — по ним считаем, не завёлся ли N+1. */
const calls: string[] = []
/** Записи PATCH: что и по какому id обновляли. */
const writes: Array<{ table: string; fields: Record<string, unknown>; filters: Array<[string, unknown]> }> = []

let collectionRows = COLLECTIONS

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsFor(table: string): any[] {
  return table === 'task_collections' ? collectionRows : ITEMS
}

function chain(table: string) {
  const filters: Array<[string, unknown]> = []
  let update: Record<string, unknown> | null = null

  const result = () => {
    if (update) {
      writes.push({ table, fields: update, filters: [...filters] })
      return { data: null, error: null }
    }
    const data = rowsFor(table).filter(row =>
      filters.every(([col, val]) =>
        Array.isArray(val)
          ? val.includes((row as Record<string, unknown>)[col])
          : (row as Record<string, unknown>)[col] === val
      )
    )
    return { data, error: null }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {
    select: () => c,
    order:  () => c,
    update: (fields: Record<string, unknown>) => { update = fields; return c },
    eq: (col: string, val: unknown) => { filters.push([col, val]); return c },
    in: (col: string, vals: unknown[]) => { filters.push([col, vals]); return c },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (f: (v: any) => unknown) => Promise.resolve(result()).then(f),
  }
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => { calls.push(table); return chain(table) },
  },
}))

// Профиль — ОДИН объект на весь прогон, как его отдаёт настоящий zustand:
// эффект загрузки списка зависит от ссылки на профиль, и новый объект на
// каждый рендер означал бы перезапрос списка в цикле.
const PROFILE = { id: ME, role: 'owner', full_name: 'Владелец' }

vi.mock('@/store/authStore', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAuthStore: (selector: any) => selector({ profile: PROFILE }),
}))

import { CollectionsPage } from '@/pages/CollectionsPage'

function renderPage() {
  return render(<MemoryRouter><CollectionsPage /></MemoryRouter>)
}

describe('CollectionsPage — «Мои подборки» (§188)', () => {
  beforeEach(() => {
    calls.length = 0
    writes.length = 0
    collectionRows = COLLECTIONS
  })

  it('показывает только свои неархивные подборки', async () => {
    renderPage()

    expect(await screen.findByText('Кинематика — контрольная')).toBeInTheDocument()
    expect(screen.getByText('Производная — домашняя')).toBeInTheDocument()
    expect(screen.queryByText('Старая подборка')).not.toBeInTheDocument()
    expect(screen.queryByText('Чужая подборка')).not.toBeInTheDocument()
  })

  it('число заданий берётся одним запросом на весь список, а не по строке', async () => {
    renderPage()

    expect(await screen.findByText('3 задания')).toBeInTheDocument()
    expect(await screen.findByText('2 задания')).toBeInTheDocument()

    await waitFor(() => expect(calls.filter(t => t === 'task_collection_items')).toHaveLength(1))
    expect(calls.filter(t => t === 'task_collections')).toHaveLength(1)
  })

  it('строка ведёт на карточку подборки', async () => {
    renderPage()

    expect(await screen.findByText('Кинематика — контрольная'))
      .toHaveAttribute('href', '/collections/c-1')
  })

  it('«В архив» убирает строку и пишет is_archived = true', async () => {
    renderPage()
    await screen.findByText('Кинематика — контрольная')

    const [archiveBtn] = screen.getAllByRole('button', { name: 'В архив' })
    fireEvent.click(archiveBtn)

    await waitFor(() =>
      expect(screen.queryByText('Кинематика — контрольная')).not.toBeInTheDocument()
    )
    expect(writes).toEqual([{
      table:   'task_collections',
      fields:  { is_archived: true },
      filters: [['id', 'c-1']],
    }])
    // Вторая строка на месте: в архив ушла ровно одна подборка.
    expect(screen.getByText('Производная — домашняя')).toBeInTheDocument()
  })

  it('пустой список — приглашение в каталог, а не пустая таблица', async () => {
    collectionRows = []
    renderPage()

    expect(await screen.findByText('Подборок пока нет')).toBeInTheDocument()
    expect(screen.getByText('Перейти в каталог заданий')).toHaveAttribute('href', '/catalog')
  })
})
