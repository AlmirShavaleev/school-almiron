import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentViewScope, useStaffModeStore } from '@/store/staffModeStore'

/**
 * §250. Страница темы ученика, встроенная во вкладку «Курс» у ОБЫЧНОГО учителя
 * (не admin/owner — у него переключателя режимов нет вовсе): под
 * `StudentViewScope` она работает как предпросмотр §178 — ученическая вёрстка,
 * сдать ДЗ нельзя (кнопка выключена), отметить рубрику нельзя, ни одной
 * записи в базу; своей шапки ученика («Назад», «Мои курсы ›») нет — на её
 * месте полоса учителя. Неопубликованное ДЗ ученику не видно — и здесь его нет.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

const rpc = vi.fn()
const queried: string[] = []
const written: string[] = []
const hwRow = { id: 'hw-1', topic_id: TOPIC, title: 'ДЗ №1', instructions: null, due_at: null, grade_scale: 'five', is_published: true }

function chain(result: unknown, count = 0) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}
/** ДЗ темы с честным фильтром `is_published` — как ответил бы PostgREST. */
function hwChain() {
  let onlyPublished = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ['select', 'order', 'in', 'limit']) c[m] = () => c
  c.eq = (col: string, v: unknown) => { if (col === 'is_published' && v === true) onlyPublished = true; return c }
  const visible = () => (onlyPublished && !hwRow.is_published ? null : hwRow)
  c.single = () => Promise.resolve({ data: visible(), error: null })
  c.maybeSingle = () => Promise.resolve({ data: visible(), error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: visible() ? [visible()] : [], error: null, count: visible() ? 1 : 0 }).then(f)
  for (const m of ['insert', 'update', 'delete', 'upsert']) c[m] = () => { written.push(`topic_homework.${m}`); return c }
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args)
      if (name === 'topic_solution_state') return Promise.resolve({ data: { has_solution: false, has_homework: true, unlocked: false }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      queried.push(table)
      if (table === 'topic_homework') return hwChain()
      const c = chain(null, 0)
      for (const m of ['insert', 'update', 'delete', 'upsert']) c[m] = () => { written.push(`${table}.${m}`); return c }
      if (table === 'topics') return Object.assign(chain({
        id: TOPIC, title: 'Отбор корней', order_index: 0, available_from: null, is_open: true, kind: 'lesson',
        modules: { id: 'mod-1', title: '№13', courses: { id: 'c1', title: 'Математика', subject: 'math' } },
      }), { insert: c.insert, update: c.update, delete: c.delete })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      if (table === 'topic_homework_files') return chain([])
      return c
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  },
}))
// Обычный учитель: роль teacher, переключателя режимов у него нет.
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'teacher-1', role: 'teacher' } }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [{ kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'theory', storagePath: `${TOPIC}/a.pdf`, fileName: 'a.pdf', sizeBytes: 1 }], loading: false, error: null }),
}))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

import { TopicPage } from '@/pages/TopicPage'

function renderEmbedded() {
  return render(
    <MemoryRouter initialEntries={['/course-program?courseId=c1&module=m&topic=t']}>
      <StudentViewScope>
        <TopicPage groupId={GROUP} topicId={TOPIC} staffBar={<div data-testid="staff-bar">Полоса учителя</div>} />
      </StudentViewScope>
    </MemoryRouter>,
  )
}

const WRITE_RPCS = ['topic_homework_start_attempt', 'topic_homework_submit_attempt', 'record_material_view', 'video_watch_add']
const WRITE_TABLES = ['topic_section_marks', 'topic_homework_attempts', 'topic_homework_attempt_files']

describe('Тема глазами ученика во вкладке «Курс» у учителя (§250)', () => {
  beforeEach(() => {
    rpc.mockClear()
    queried.length = 0
    written.length = 0
    hwRow.is_published = true
    useStaffModeStore.setState({ mode: 'admin', profileId: 'teacher-1', choiceMade: true })
  })

  it('ученическая вёрстка без шапки ученика; на её месте — полоса учителя', async () => {
    renderEmbedded()
    expect(await screen.findByRole('heading', { name: 'Отбор корней' })).toBeInTheDocument()
    expect(screen.getByTestId('staff-bar')).toBeInTheDocument()
    expect(screen.queryByText('Мои курсы')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Назад/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-tab-group-theory')).toBeInTheDocument()
    // Строку students не ищет: у учителя её нет, тема — под его RLS.
    expect(queried).not.toContain('students')
  })

  it('«Отметить как сделанное» выключено с подсказкой; «Сдать ДЗ» выключено; ничего не пишется', async () => {
    renderEmbedded()
    const mark = await screen.findByTestId('topic-group-mark-theory')
    expect(mark).toBeDisabled()
    expect(mark).toHaveAttribute('title', 'В предпросмотре не сохраняется')
    fireEvent.click(mark)
    expect(mark).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('tab', { name: /Домашнее задание/ }))
    const start = await screen.findByTestId('hw-start-attempt')
    expect(start).toBeDisabled()
    fireEvent.click(start)

    for (const name of WRITE_RPCS) expect(rpc, name).not.toHaveBeenCalledWith(name, expect.anything())
    for (const table of WRITE_TABLES) expect(queried, table).not.toContain(table)
    expect(written).toEqual([])
  })

  it('неопубликованное ДЗ ученику не видно — и во «Курсе» вкладки «Домашнее задание» нет', async () => {
    hwRow.is_published = false
    renderEmbedded()
    await screen.findByRole('heading', { name: 'Отбор корней' })
    await waitFor(() => expect(screen.getByTestId('topic-tab-group-theory')).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: /Домашнее задание/ })).not.toBeInTheDocument()
  })
})
