import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress, TopicProgress } from '@/hooks/useStudentCourseProgram'
import type { TopicSection } from '@/lib/topicMaterialItems'

/**
 * §182. Тема в списке курса: три сигнала «что делать» вместо перечня рубрик.
 *
 * Проверяется то, что видит ученик, а не текст исходника: под названием темы —
 * «Видео», «Задачи N из M» и состояние ДЗ, остальные рубрики свёрнуты в серую
 * строку «ещё N материалов»; плашки «Конспект» и «Решение ДЗ» пропали; правая
 * плашка «В работе» не рисуется, а кнопка «Сдать ДЗ» остаётся.
 */

const topic = (id: string, over: Partial<TopicProgress> = {}): TopicProgress => ({
  id, title: `Тема ${id}`, order_index: 1, max_score: 100,
  available_from: null, is_open: true, sections: new Set<TopicSection>(),
  hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null,
  hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null,
  tasks_total: 0, tasks_closed: 0,
  completed_count: 0, assignment_count: 0,
  ...over,
})

const sections = (...keys: TopicSection[]) => new Set<TopicSection>(keys)

let topics: TopicProgress[] = []

const modules = (): ModuleProgress[] => [{
  id: 'm1', title: 'Механика', order_index: 1, topics,
  done: 0, total: 0,
  counters: countTopics(topics.map(t => ({
    is_open: t.is_open, available_from: t.available_from,
    hasHomework: !!t.hw_id, hwStatus: t.hw_status,
  }))),
}]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => ({
    course: {
      id: 'c1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege',
      group_name: '11А', teacher: null, curator: null,
    },
    modules: modules(),
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}))

vi.mock('@/hooks/useStudentWeekPlan', () => ({
  useStudentWeekPlan: () => ({ courses: [], loading: false, error: null }),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'p1', role: 'student' } }),
}))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

/** Курс открывается на списке разделов — в раздел надо зайти. */
async function openModule(view: 'list' | 'cards' = 'list') {
  localStorage.setItem('student-course-view', view)
  render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByText('Механика'))
  return screen.findAllByTestId(view === 'list' ? 'topic-list-row' : 'lesson-card')
}

const rows = () => screen.getAllByTestId('topic-list-row')

beforeEach(() => {
  localStorage.clear()
  topics = []
})

describe('§182 — три сигнала под названием темы', () => {
  it('видео, задачи «3 из 7», несданное ДЗ и «ещё N материалов» — и ни одной плашки рубрики', async () => {
    topics = [topic('t1', {
      sections: sections('video', 'theory', 'notes', 'worksheet_tasks', 'solution', 'homework'),
      hw_id: 'hw1', hw_status: 'not_started',
      tasks_total: 7, tasks_closed: 3,
    })]
    await openModule()
    const row = rows()[0]

    expect(row).toHaveTextContent('Видео')
    expect(row).toHaveTextContent('Задачи 3 из 7')
    expect(row).toHaveTextContent('ДЗ не сдано')
    // theory, notes, worksheet_tasks, solution — четыре непоказанные рубрики
    expect(row).toHaveTextContent('ещё 4 материала')

    // Перечня рубрик больше нет: ни «Конспект», ни «Решение ДЗ»
    expect(row).not.toHaveTextContent('Конспект')
    expect(row).not.toHaveTextContent('Решение ДЗ')
    expect(row).not.toHaveTextContent('Рабочий лист')
  })

  it('«В работе» не рисуется, но «Сдать ДЗ» остаётся', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'not_started', tasks_total: 7, tasks_closed: 3 })]
    await openModule()
    const row = rows()[0]

    expect(row).not.toHaveTextContent('В работе')
    expect(within(row).queryAllByRole('status')).toHaveLength(0)
    expect(within(row).getByRole('button', { name: 'Сдать домашнее задание' })).toBeTruthy()
  })

  it('тема на проверке: сигнал «ДЗ на проверке» и правая плашка «На проверке»', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'submitted' })]
    await openModule()
    const row = rows()[0]

    expect(row).toHaveTextContent('ДЗ на проверке')
    // Плашка статуса рисуется дважды — узкая для телефона и широкая для
    // десктопа, видна всегда одна; в jsdom в дереве обе.
    for (const badge of within(row).getAllByRole('status')) expect(badge).toHaveTextContent('На проверке')
  })

  it('принятое ДЗ с баллом: «ДЗ: 18/20 б», и это число в строке одно', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'accepted', hw_score: 18, hw_max: 20 })]
    await openModule()
    const row = rows()[0]

    expect(row).toHaveTextContent('ДЗ: 18/20 б')
    for (const badge of within(row).getAllByRole('status')) expect(badge).toHaveTextContent('Пройдено')
    expect(row.textContent?.match(/18\s*\/\s*20/g) ?? []).toHaveLength(1)
  })

  it('принятое ДЗ без шкалы: «ДЗ принято», без выдуманного «из»', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'accepted', hw_score: null, hw_max: null })]
    await openModule()
    expect(rows()[0]).toHaveTextContent('ДЗ принято')
  })

  it('возвращённое ДЗ: «ДЗ вернули»', async () => {
    topics = [topic('t1', { hw_id: 'hw1', hw_status: 'returned' })]
    await openModule()
    expect(rows()[0]).toHaveTextContent('ДЗ вернули')
  })

  it('тема без задач: плашки задач нет вовсе', async () => {
    topics = [topic('t1', { sections: sections('video'), tasks_total: 0, tasks_closed: 0 })]
    await openModule()
    expect(rows()[0]).not.toHaveTextContent('Задачи')
  })

  it('ни одной решённой: «Задачи: 7», а не «0 из 7»', async () => {
    topics = [topic('t1', { tasks_total: 7, tasks_closed: 0 })]
    await openModule()
    const row = rows()[0]
    expect(row).toHaveTextContent('Задачи: 7')
    expect(row).not.toHaveTextContent('0 из 7')
  })

  it('решены все: «Задачи 7 из 7» зелёным', async () => {
    topics = [topic('t1', { tasks_total: 7, tasks_closed: 7 })]
    await openModule()
    const pill = screen.getByText('Задачи 7 из 7')
    expect(pill.className).toContain('green')
  })

  it('прогресс не приехал (RPC недоступна) — экран рисуется, «N из M» нет', async () => {
    // Хук в этом случае отдаёт нули (console.warn и пустая карта): тема без
    // задач и тема с задачами на экране неотличимы, но список цел.
    topics = [
      topic('t1', { sections: sections('video'), hw_id: 'hw1', hw_status: 'not_started', tasks_total: 0, tasks_closed: 0 }),
      topic('t2', { sections: sections('theory'), tasks_total: 0, tasks_closed: 0 }),
    ]
    await openModule()
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toHaveTextContent('Видео')
    expect(rows()[0]).toHaveTextContent('ДЗ не сдано')
    expect(rows()[0]).not.toHaveTextContent('из')
  })

  it('единственная рубрика без состояния: «ещё 1 материал»', async () => {
    topics = [topic('t1', { sections: sections('theory') })]
    await openModule()
    expect(rows()[0]).toHaveTextContent('ещё 1 материал')
  })

  it('непоказанных рубрик нет — строки «ещё» нет', async () => {
    topics = [topic('t1', { sections: sections('video', 'homework'), hw_id: 'hw1', hw_status: 'not_started' })]
    await openModule()
    expect(rows()[0]).not.toHaveTextContent('ещё')
  })

  it('закрытая тема сигналов не показывает — только причину', async () => {
    topics = [topic('t1', {
      is_open: false, sections: sections('video', 'theory'),
      hw_id: 'hw1', hw_status: 'not_started', tasks_total: 7, tasks_closed: 3,
    })]
    await openModule()
    const row = rows()[0]
    expect(within(row).queryByTestId('topic-signals')).toBeNull()
    expect(row).toHaveTextContent('Закрыт')
  })
})

describe('§274 — вид «Карточки»: карточка урока', () => {
  it('плашки «что внутри» и строка состояния; решения ДЗ не обещаем', async () => {
    topics = [topic('t1', {
      sections: sections('video', 'theory', 'notes', 'solution', 'homework'),
      hw_id: 'hw1', hw_status: 'submitted',
      tasks_total: 5, tasks_closed: 5,
    })]
    const [card] = await openModule('cards')

    const chips = within(card).getByTestId('lesson-chips')
    expect([...chips.querySelectorAll('[data-chip]')].map(c => c.textContent)).toEqual([
      'Видео', 'Теория и конспект', 'Задачи · 5', 'ДЗ',
    ])
    expect(card).not.toHaveTextContent('Решение ДЗ')
    expect(within(card).getByTestId('lesson-status')).toHaveTextContent('Сдано · на проверке')
    expect(card.tagName).toBe('A')
    expect(card.getAttribute('href')).toBe('/my-course/g1/topic/t1')
  })

  it('без сохранённого выбора открывается вид «Карточки»', async () => {
    topics = [topic('t1')]
    render(
      <MemoryRouter initialEntries={['/my-course/g1']}>
        <Routes>
          <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByText('Механика'))
    expect(await screen.findByTestId('topics-cards-view')).toBeInTheDocument()
    expect(screen.getByTestId('view-toggle-cards')).toHaveAttribute('aria-pressed', 'true')
  })

  it('закрытая тема — не ссылка: замок и «Откроется позже», плашек нет', async () => {
    topics = [topic('t1', { is_open: false, sections: sections('video', 'theory'), hw_id: 'hw1', hw_status: 'not_started' })]
    const [card] = await openModule('cards')
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveAttribute('data-locked')
    expect(within(card).queryByTestId('lesson-chips')).toBeNull()
    expect(within(card).getByTestId('lesson-status')).toHaveTextContent('Откроется позже')
  })
})
