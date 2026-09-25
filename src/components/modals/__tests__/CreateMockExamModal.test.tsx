/**
 * §219. Пробник, заведённый владельцем, получает created_by.
 *
 * У владельца в профиле роль admin, а строка `teachers` есть (§73). Строку
 * искали только при `role === 'teacher'` — и три пробника владельца легли на
 * проде с created_by = null. `mock_exams.created_by` ссылается на
 * `teachers(id)`, не на профиль.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

let role: string
let profile: { id: string; role: string }
let teacherRow: { id: string } | null
let inserted: Record<string, unknown>[]

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile }),
}))
vi.mock('@/hooks/useMockExamTemplates', () => ({
  useMockExamTemplates: () => ({
    templates: [{ id: 'tpl', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 2], part1_last: 2, score_scale: null }],
    loading: false,
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: table === 'teachers' ? teacherRow : null, error: null })
      chain.single = () => Promise.resolve(table === 'mock_exams'
        ? { data: { id: 'new-exam' }, error: null }
        : { data: table === 'teachers' ? teacherRow : null, error: teacherRow ? null : { message: 'no rows' } })
      chain.order = () => Promise.resolve({ data: [{ id: 'g1', name: '11А' }], error: null })
      chain.insert = (row: Record<string, unknown>) => { inserted.push(row); return chain }
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'g1', name: '11А' }], error: null }).then(res)
      return chain
    },
  },
}))

import { CreateMockExamModal } from '@/components/modals/CreateMockExamModal'

async function createOne() {
  profile = { id: 'p-owner', role }
  const onCreated = vi.fn()
  render(<CreateMockExamModal open onClose={() => {}} onCreated={onCreated} />)
  const title = await screen.findByLabelText('Название')
  fireEvent.change(title, { target: { value: 'Пробник №4' } })
  fireEvent.change(screen.getByLabelText('Шаблон'), { target: { value: 'tpl' } })
  await waitFor(() => expect(screen.getByRole('option', { name: '11А' })).toBeTruthy())
  fireEvent.change(screen.getByLabelText('Группа'), { target: { value: 'g1' } })
  fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-10-18' } })
  fireEvent.click(screen.getByRole('button', { name: /Создать и открыть таблицу/ }))
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-exam'))
}

beforeEach(() => {
  cleanup()
  inserted = []
  teacherRow = { id: 't-owner' }
})

describe('CreateMockExamModal — created_by', () => {
  it('владелец с ролью admin и строкой teachers — created_by = его teachers.id', async () => {
    role = 'admin'
    await createOne()
    expect(inserted).toHaveLength(1)
    expect(inserted[0].created_by).toBe('t-owner')
  })

  it('преподаватель — как и раньше, его teachers.id', async () => {
    role = 'teacher'
    await createOne()
    expect(inserted[0].created_by).toBe('t-owner')
  })

  it('строки teachers нет (чистый админ) — null, а не ошибка', async () => {
    role = 'admin'
    teacherRow = null
    await createOne()
    expect(inserted[0].created_by).toBeNull()
  })
})
