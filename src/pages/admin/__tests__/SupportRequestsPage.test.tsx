import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/**
 * Экран обращений «Сообщить о проблеме» (§169).
 *
 * Сторожится то, ради чего экран заведён: по умолчанию видны именно НОВЫЕ
 * обращения (те, что пролежали месяц); «В работу» и «Закрыть» меняют статус в
 * базе, а не только на экране; закрытие пишет, кто и когда закрыл; отказ базы
 * виден словами, а не пустым списком (уроки §47/§54).
 */

type Row = Record<string, unknown>
let rows: Row[] = []
let selectError: { message: string } | null = null
const selectFilters: Array<[string, unknown]> = []
let selects = 0
const updates: Array<{ patch: Row; id: string }> = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin-1' } } }) },
    storage: {
      from: () => ({ createSignedUrl: (path: string) => Promise.resolve({ data: { signedUrl: `signed:${path}` } }) }),
    },
    from: (table: string) => {
      if (table !== 'support_requests') throw new Error(`unexpected table ${table}`)
      type Q = {
        select: () => Q
        eq: (col: string, val: unknown) => Q
        order: () => Q
        limit: () => Promise<{ data: Row[] | null; error: { message: string } | null }>
        update: (patch: Row) => { eq: (col: string, id: string) => Promise<{ error: null }> }
      }
      const q: Q = {
        select: () => { selects += 1; return q },
        eq: (col: string, val: unknown) => { selectFilters.push([col, val]); return q },
        order: () => q,
        limit: () => Promise.resolve({ data: selectError ? null : rows, error: selectError }),
        update: (patch: Row) => ({
          eq: (_col: string, id: string) => { updates.push({ patch, id }); return Promise.resolve({ error: null }) },
        }),
      }
      return q
    },
  },
}))

import { SupportRequestsPage } from '@/pages/admin/SupportRequestsPage'

const NEW_ROW: Row = {
  id: 'r-1', author_id: 'u-1', author_name: 'Тимур', author_role: 'student',
  subject: 'Не открывается конспект', message: 'Нажимаю на конспект темы 14 — крутится и ничего.',
  page_path: '/student/course/abc', attachments: ['u-1/shot.png'], status: 'new',
  created_at: '2026-08-03T10:00:00.000Z', resolved_at: null,
}

beforeEach(() => {
  rows = [NEW_ROW]
  selectError = null
  selectFilters.length = 0
  selects = 0
  updates.length = 0
})

describe('экран обращений', () => {
  it('по умолчанию запрашивает и показывает только новые', async () => {
    render(<SupportRequestsPage />)
    expect(await screen.findByText('Не открывается конспект')).toBeInTheDocument()
    expect(selectFilters).toContainEqual(['status', 'new'])
    expect(screen.getByText('Тимур')).toBeInTheDocument()
    expect(screen.getByText('Ученик')).toBeInTheDocument()
    expect(screen.getByText(/Нажимаю на конспект/)).toBeInTheDocument()
  })

  it('скриншот подписывается на момент показа, в строке лежит только путь', async () => {
    render(<SupportRequestsPage />)
    const img = await screen.findByAltText('Скриншот к обращению')
    expect(img).toHaveAttribute('src', 'signed:u-1/shot.png')
  })

  it('«В работу» пишет статус в базу и убирает строку из списка новых', async () => {
    render(<SupportRequestsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'В работу' }))

    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].id).toBe('r-1')
    expect(updates[0].patch).toMatchObject({ status: 'in_progress', resolved_at: null, resolved_by: null })
    await waitFor(() => expect(screen.queryByText('Не открывается конспект')).not.toBeInTheDocument())
    expect(screen.getByText('Новых обращений нет')).toBeInTheDocument()
  })

  it('«Закрыть» записывает, кто и когда закрыл', async () => {
    render(<SupportRequestsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть' }))

    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0].patch.status).toBe('closed')
    expect(updates[0].patch.resolved_by).toBe('admin-1')
    expect(typeof updates[0].patch.resolved_at).toBe('string')
  })

  it('переключение на «Все» снимает фильтр по статусу', async () => {
    render(<SupportRequestsPage />)
    await screen.findByText('Не открывается конспект')
    selectFilters.length = 0
    selects = 0

    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    await waitFor(() => expect(selects).toBe(1))
    expect(selectFilters.find(([col]) => col === 'status')).toBeUndefined()
  })

  it('закрытое обращение можно открыть заново, закрыть повторно — нет', async () => {
    rows = [{ ...NEW_ROW, status: 'closed', resolved_at: '2026-09-01T10:00:00.000Z' }]
    render(<SupportRequestsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    expect(await screen.findByRole('button', { name: 'Открыть заново' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })

  it('отказ базы виден словами, а не пустым списком', async () => {
    selectError = { message: 'permission denied for table support_requests' }
    render(<SupportRequestsPage />)
    expect(await screen.findByText(/permission denied/)).toBeInTheDocument()
    expect(screen.queryByText('Новых обращений нет')).not.toBeInTheDocument()
  })
})
