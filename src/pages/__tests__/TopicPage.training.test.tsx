import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'
import { buildTrainingSubtopics, type TrainingItemRow, type TrainingSubtopic } from '@/lib/training'

/**
 * §234. Вкладка «Тренировка» на странице темы: своя группа между «Теорией» и
 * «Уроком», у «Урока» — пометка «Формат ЕГЭ». Тема без тренировки (математика)
 * остаётся ровно такой, как была.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000234'
const GROUP = 'g0000000-0000-0000-0000-000000000234'

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'theory', storagePath: `${TOPIC}/a.pdf`, fileName: 'a.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
]

const SECTIONS = ['theory', 'tasks', 'worksheet_tasks', 'task_solution', 'homework_tasks', 'worksheet_homework', 'solution']
const rows = (code: string, title: string): TrainingItemRow[] => SECTIONS.map((section, position) => ({
  id: `${code}-${position}`, topic_id: TOPIC, kind: 'file', title: null, storage_path: `${TOPIC}/${code}-${position}.pdf`,
  file_name: `${position}.pdf`, size_bytes: 1, position, is_visible: true, section, subtopic_code: code, subtopic_title: title,
}))

const training: { subtopics: TrainingSubtopic[] } = { subtopics: [] }

function chain(result: unknown, count = 0) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'topics') return chain({
        id: TOPIC, title: 'Кинематика. Баллистика', order_index: 0, available_from: null,
        modules: { id: 'mod-1', title: 'Механика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      return chain(null, 0)
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))
// Профиль — один объект на весь тест, как в настоящем сторе: новый объект на
// каждый рендер перезапускал бы загрузку темы и сворачивал аккордеон.
const AUTH = { profile: { id: 'u1', role: 'student' } }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel(AUTH),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials, loading: false, error: null }),
}))
vi.mock('@/hooks/useTopicTraining', () => ({
  useTopicTraining: () => ({ subtopics: training.subtopics, loading: false, error: null, setSubtopicHidden: vi.fn() }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: false, unlocked: true, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

import { TopicPage } from '@/pages/TopicPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Вкладка «Тренировка» (§234)', () => {
  beforeEach(() => {
    training.subtopics = buildTrainingSubtopics(
      [...rows('1.18', 'Бросок под углом'), ...rows('1.14', 'Свободное падение'), ...rows('1.15', 'Путь в n-ю секунду'), ...rows('1.17', 'Горизонтальный бросок')],
      ['1.15'],
    )
  })

  it('группа стоит между «Теорией» и «Уроком», у «Урока» — «Формат ЕГЭ»', async () => {
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })

    const order = [...document.querySelectorAll('[data-testid^="topic-tab-group-"]')].map(el => el.getAttribute('data-testid'))
    expect(order.slice(0, 3)).toEqual(['topic-tab-group-theory', 'topic-tab-group-training', 'topic-tab-group-lesson'])
    expect(within(screen.getByTestId('topic-tab-group-lesson')).getByTestId('ege-format-mark')).toHaveTextContent('Формат ЕГЭ')
    expect(within(screen.getByTestId('topic-tab-group-training')).getByTestId('training-mark')).toHaveTextContent('Тренировка')
    // Три видимые подтемы: 1.15 скрыта учителем.
    expect(screen.getByTestId('topic-tab-training')).toHaveTextContent('Подтемы3')
  })

  it('на вкладке — пояснение и подтемы в порядке кодификатора, без скрытой', async () => {
    renderPage()
    fireEvent.click(await screen.findByTestId('topic-tab-training'))

    expect(await screen.findByTestId('topic-training')).toHaveTextContent('Задачи на отработку приёмов. Не в формате ЕГЭ, в прогноз балла не идут.')
    const codes = screen.getAllByTestId('training-subtopic').map(el => el.getAttribute('data-code'))
    expect(codes).toEqual(['1.14', '1.17', '1.18'])

    // Первая раскрыта: «На уроке» — четыре файла, «Дома» — три.
    const first = screen.getAllByTestId('training-subtopic')[0]
    expect(within(first).getByTestId('training-place-lesson').querySelectorAll('a')).toHaveLength(4)
    expect(within(first).getByTestId('training-place-home')).toHaveTextContent('ДЗ · список задачДЗ · рабочий листДЗ · решения')

    // Аккордеон: вторая подтема свёрнута и раскрывается по нажатию.
    const second = screen.getAllByTestId('training-subtopic')[1]
    expect(within(second).queryByTestId('training-place-lesson')).toBeNull()
    fireEvent.click(within(second).getByRole('button', { expanded: false }))
    expect(within(second).getByTestId('training-place-lesson')).toBeInTheDocument()
  })

  it('тема без тренировки — ни группы, ни «Формат ЕГЭ» (математика не меняется)', async () => {
    training.subtopics = []
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })

    expect(screen.queryByTestId('topic-tab-group-training')).toBeNull()
    expect(screen.queryByTestId('ege-format-mark')).toBeNull()
    expect(screen.queryByTestId('training-mark')).toBeNull()
  })

  it('все подтемы скрыты — группы нет, пометки «Формат ЕГЭ» тоже', async () => {
    training.subtopics = buildTrainingSubtopics(rows('1.14', 'Свободное падение'), ['1.14'])
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })

    expect(screen.queryByTestId('topic-tab-group-training')).toBeNull()
    expect(screen.queryByTestId('ege-format-mark')).toBeNull()
  })
})
