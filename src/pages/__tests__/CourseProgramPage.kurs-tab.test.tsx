import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import type { TopicProgress, ModuleProgress } from '@/hooks/useStudentCourseProgram'

/**
 * §250. Вкладки курса у учителя: «Курс» — первая и по умолчанию, «Программа
 * курса» стала «Сроки и статистика» (старый `?tab=program` открывает её);
 * «Курс»: разделы → раздел → тема и обратно — в адресе («назад» браузера);
 * строка класса у темы; ученическая программа и страница темы — в режиме
 * «как ученик» (`usePreviewMode()` = true под `StudentViewScope`); «Открыть
 * раньше» — тумблер темы; «Редактировать тему» — привычное окно темы.
 */

const TODAY = new Date().toLocaleDateString('en-CA')
const FUTURE = new Date(Date.now() + 20 * 864e5).toLocaleDateString('en-CA')
const PAST = new Date(Date.now() - 5 * 864e5).toLocaleDateString('en-CA')

function makeChain(result: { data: unknown; error: { message?: string } | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') { const p = Promise.resolve(result); return p.then.bind(p) }
      return () => chain
    },
  })
  return chain
}

const JOURNAL = {
  server_now: new Date().toISOString(), today: TODAY, is_template: false, group_id: 'g1', group_name: '11А',
  students: [{ student_id: 's1', name: 'Абрамова Софья' }, { student_id: 's2', name: 'Белов Кирилл' }, { student_id: 's3', name: 'Валиев Тимур' }],
  homeworks: [
    { topic_id: 't1', homework_id: 'h1', module_id: 'm1', module_title: '№13', module_order: 1, topic_title: 'Методы решения', topic_order: 1, due_at: PAST, grade_scale: 'five', topic_open: true },
  ],
  cells: [
    { topic_id: 't1', student_id: 's1', status: 'reviewed', score: 5, attempt_id: 'a1', attempt_number: 1 },
    { topic_id: 't1', student_id: 's2', status: 'submitted', score: null, attempt_id: 'a2', attempt_number: 1 },
  ],
}
const rpcSpy = vi.fn((fn: string) => Promise.resolve(fn === 'course_homework_grades' ? { data: JOURNAL, error: null } : { data: [], error: null }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeChain(table === 'groups' ? { data: [{ id: 'g1', name: '11А' }], error: null } : { data: [], error: null }),
    rpc: (fn: string) => rpcSpy(fn),
  },
}))
const role = { value: 'teacher' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'teacher-1', role: role.value } }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), saved: vi.fn() } }))
const saveTopic = vi.fn().mockResolvedValue(undefined)
const COURSES = [
  { id: 'c1', title: 'Математика ЕГЭ — 11А', subject: 'math', exam_type: 'ege', description: null, price: 0, duration_weeks: 36, is_active: true, is_draft: false, is_template: false, copied_from_course_id: null, owner_id: 'teacher-1', start_date: null, end_date: null, enrollment_open_until: null },
]
const TEACHER_MODULES = [{ id: 'm1', course_id: 'c1', title: '№13', order_index: 1, topics: [
  { id: 't1', module_id: 'm1', title: 'Методы решения', order_index: 1, max_score: 100, available_from: null, is_open: true },
  { id: 't2', module_id: 'm1', title: 'Задачи ЕГЭ', order_index: 2, max_score: 100, available_from: FUTURE, is_open: null },
] }]
vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: COURSES, loading: false,
    loadModules: vi.fn().mockResolvedValue(TEACHER_MODULES),
    saveCourse: vi.fn(), createCourse: vi.fn(), saveModule: vi.fn(), createModule: vi.fn(), deleteModule: vi.fn(),
    saveTopic: (...a: unknown[]) => saveTopic(...a), createTopic: vi.fn(), deleteTopic: vi.fn(),
  }),
}))
vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({ useCourseHomeworkTemplates: () => ({ templates: [] }) }))
vi.mock('@/components/modals/TopicMaterialsModal', () => ({
  TopicMaterialsModal: ({ open, topicTitle }: { open: boolean; topicTitle: string }) => (open ? <div data-testid="topic-window">{topicTitle}</div> : null),
}))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

// Программа ученика — подменена, но спрашивает тот же `usePreviewMode()`, что
// настоящий хук: так видно, что вкладка «Курс» включает режим «как ученик».
const programCalls: { groupId: string | null | undefined; preview: boolean }[] = []
const reload = vi.fn()
function topic(id: string, title: string, over: Partial<TopicProgress> = {}): TopicProgress {
  return {
    id, title, order_index: 1, max_score: 100, available_from: null, is_open: true, kind: 'lesson',
    sections: new Set(['video', 'notes']) as TopicProgress['sections'],
    hw_id: null, hw_title: null, hw_instructions: null, hw_due_at: null, hw_grade_scale: null, hw_status: null, hw_score: null, hw_max: null, hw_comment: null,
    test_assignment_id: null, test_title: null, test_status: null, test_points: null, test_max_points: null,
    tasks_total: 0, tasks_closed: 0, completed_count: 0, assignment_count: 0, ...over,
  }
}
const STUDENT_MODULES: ModuleProgress[] = [
  { id: 'm1', title: '№13', order_index: 1, done: 0, total: 0, counters: { openTopics: 1, totalTopics: 2, homeworkAvailable: 1, homeworkSubmitted: 0 }, topics: [
    topic('t1', 'Методы решения', { hw_id: 'h1', hw_due_at: PAST, hw_status: 'not_started' }),
    topic('t2', 'Задачи ЕГЭ', { is_open: null, available_from: FUTURE }),
  ] },
  { id: 'm2', title: '№9 Задачи прикладного характера', order_index: 2, done: 0, total: 0, counters: { openTopics: 0, totalTopics: 1, homeworkAvailable: 0, homeworkSubmitted: 0 }, topics: [
    topic('t3', 'Прикладные', { is_open: false }),
  ] },
]
vi.mock('@/hooks/useStudentCourseProgram', async () => {
  const { usePreviewMode } = await import('@/store/staffModeStore')
  return {
    useStudentCourseProgram: (groupId: string | null | undefined) => {
      programCalls.push({ groupId, preview: usePreviewMode() })
      return { course: { id: 'c1' }, modules: STUDENT_MODULES, mockExams: [], loading: false, error: null, reload }
    },
  }
})
// Страница темы ученика — подменена: здесь проверяется, ЧТО и КАК вкладка её
// встраивает (группа, тема, режим, полоса учителя). Сама страница в режиме
// «как ученик» — в TopicPage.staffView.test.tsx.
vi.mock('@/pages/TopicPage', async () => {
  const { usePreviewMode } = await import('@/store/staffModeStore')
  return {
    TopicPage: ({ groupId, topicId, staffBar }: { groupId?: string; topicId?: string; staffBar?: React.ReactNode }) => (
      <div data-testid="student-topic-page" data-group={groupId} data-topic={topicId} data-preview={String(usePreviewMode())}>{staffBar}</div>
    ),
  }
})

import { CourseProgramPage } from '@/pages/CourseProgramPage'

function Where() {
  const loc = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <div data-testid="where">{loc.search}</div>
      <button type="button" onClick={() => navigate(-1)}>браузер-назад</button>
    </>
  )
}
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CourseProgramPage />
      <Where />
    </MemoryRouter>,
  )
}
const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent)
const where = () => screen.getByTestId('where').textContent ?? ''

beforeEach(() => {
  role.value = 'teacher'
  programCalls.length = 0
  rpcSpy.mockClear()
  saveTopic.mockClear()
  reload.mockClear()
})

describe('Вкладки курса (§250)', () => {
  it('«Курс» — первая; «Программа курса» теперь «Сроки и статистика»; без ?tab= открыт «Курс»', async () => {
    renderAt('/course-program?courseId=c1')
    expect(tabNames()).toEqual(['Курс', 'Сроки и статистика', 'Материалы', 'Домашние задания', 'Проверочные и контрольные', 'Ученики', 'Настройки'])
    expect(screen.getByRole('tab', { name: 'Курс' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByTestId('kurs-sections')).toBeInTheDocument()
  })

  it('старый адрес ?tab=program открывает «Сроки и статистику» (программу), а не «Курс»', async () => {
    renderAt('/course-program?courseId=c1&tab=program')
    expect(screen.getByRole('tab', { name: 'Сроки и статистика' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('kurs-sections')).not.toBeInTheDocument()
  })

  it('клик по «Сроки и статистика» пишет ?tab=program; обратно на «Курс» — вкладка из адреса уходит', async () => {
    renderAt('/course-program?courseId=c1')
    fireEvent.click(screen.getByRole('tab', { name: 'Сроки и статистика' }))
    await waitFor(() => expect(where()).toContain('tab=program'))
    fireEvent.click(screen.getByRole('tab', { name: 'Курс' }))
    await waitFor(() => expect(where()).not.toContain('tab='))
  })
})

describe('«Курс»: разделы → раздел → тема (§250)', () => {
  it('программа ученика — по группе курса и в режиме «как ученик»; карточки разделов с цифрами класса', async () => {
    renderAt('/course-program?courseId=c1')
    const cards = await screen.findAllByTestId('kurs-section-card')
    expect(programCalls.at(-1)).toEqual({ groupId: 'g1', preview: true })
    await waitFor(() => expect(screen.getByTestId('kurs-meta')).toHaveTextContent('2 раздела · 1 из 3 тем открыто · ДЗ ждут проверки: 1'))
    await waitFor(() => expect(within(cards[0]).getByTestId('kurs-section-chips')).toHaveTextContent('ДЗ: 1'))
    expect(within(cards[0]).getByTestId('kurs-section-chips')).toHaveTextContent('сдано 2')
    expect(within(cards[0]).getByTestId('kurs-section-chips')).toHaveTextContent('ждут 1')
    expect(within(cards[0]).getByTestId('kurs-section-chips')).toHaveTextContent('средний 5,0')
    expect(within(cards[0]).getByTestId('kurs-section-open')).toHaveTextContent(/^1 из 2 тем открыто · дальше с /)
    expect(cards[1]).toHaveAttribute('data-locked', 'true')
    expect(within(cards[1]).getByTestId('kurs-section-open')).toHaveTextContent('0 из 1 темы открыто')
    // У обычного учителя переключателя режимов нет — нет и «Смотреть как ученик».
    expect(screen.queryByTestId('kurs-preview')).not.toBeInTheDocument()
  })

  it('раздел и тема — в адресе; крошки и «назад» браузера возвращают на уровень выше', async () => {
    renderAt('/course-program?courseId=c1')
    fireEvent.click((await screen.findAllByTestId('kurs-section-card'))[0])
    await waitFor(() => expect(where()).toContain('module=m1'))
    expect(screen.getByTestId('kurs-crumbs')).toHaveTextContent('Курс№13')
    expect(screen.getAllByTestId('kurs-topic-row')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Открыть тему Методы решения' }))
    await waitFor(() => expect(where()).toContain('topic=t1'))
    // §253: страница темы во вкладке грузится лениво (React.lazy) — ждём её.
    const page = await screen.findByTestId('student-topic-page')
    expect(page).toHaveAttribute('data-group', 'g1')
    expect(page).toHaveAttribute('data-topic', 't1')
    expect(page).toHaveAttribute('data-preview', 'true')
    expect(within(screen.getByTestId('kurs-crumbs')).getByText('Тема 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'браузер-назад' }))
    await waitFor(() => expect(where()).not.toContain('topic='))
    expect(screen.getByTestId('kurs-section')).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('kurs-crumbs')).getByRole('button', { name: 'Курс' }))
    await waitFor(() => expect(where()).not.toContain('module='))
    expect(screen.getByTestId('kurs-sections')).toBeInTheDocument()
  })

  it('строка класса у открытой темы с ДЗ: сдали X из Y · ждут проверки · средний · просрочили; ДЗ — со сроком', async () => {
    renderAt('/course-program?courseId=c1&module=m1')
    const rows = await screen.findAllByTestId('kurs-topic-row')
    await waitFor(() => expect(within(rows[0]).getByTestId('kurs-class-line')).toBeInTheDocument())
    const line = within(rows[0]).getByTestId('kurs-class-line')
    expect(line).toHaveTextContent('Класс:сдали 2 из 3ждут проверки 1средний 5,0просрочили 1')
    // Сигнал ДЗ у учителя — срок, а не «ДЗ не сдано» ученика.
    expect(within(rows[0]).getByTestId('topic-signals')).toHaveTextContent(/ДЗ до \d+/)
    expect(within(rows[0]).getByTestId('topic-signals')).not.toHaveTextContent('не сдано')
    // Закрытая тема: «откроется …», без строки класса, есть «Открыть раньше».
    expect(rows[1]).toHaveAttribute('data-open', 'false')
    expect(within(rows[1]).getByTestId('kurs-topic-opens')).toHaveTextContent(/^откроется /)
    expect(within(rows[1]).queryByTestId('kurs-class-line')).not.toBeInTheDocument()
  })

  it('«Открыть раньше» — тот же тумблер, что в «Сроках»: is_open = true; программа ученика перечитывается', async () => {
    renderAt('/course-program?courseId=c1&module=m1')
    fireEvent.click(await screen.findByTestId('kurs-topic-open-early'))
    await waitFor(() => expect(saveTopic).toHaveBeenCalledWith('t2', { is_open: true }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('тема: полоса учителя — «Класс: сдали ДЗ 2 из 3 · ждут проверки 1», «Проверить 1» → очередь по теме, «Редактировать тему» → окно темы', async () => {
    renderAt('/course-program?courseId=c1&module=m1&topic=t1')
    const bar = await screen.findByTestId('kurs-teacher-bar')
    await waitFor(() => expect(within(bar).getByTestId('kurs-teacher-bar-class')).toHaveTextContent('Класс: сдали ДЗ 2 из 3 · ждут проверки 1'))
    expect(within(bar).getByRole('link', { name: 'Проверить 1' })).toHaveAttribute('href', '/homework-queue?topic=t1')
    // Окно темы ищет тему в программе курса — она грузится отдельно.
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('course_homework_grades'))
    await screen.findByRole('tab', { name: 'Курс' })
    await waitFor(() => {
      fireEvent.click(within(bar).getByRole('button', { name: 'Редактировать тему' }))
      expect(screen.getByTestId('topic-window')).toHaveTextContent('Методы решения')
    })
  })

  it('у владельца (есть предпросмотр §178) — кнопка «Смотреть как ученик»', async () => {
    role.value = 'owner'
    renderAt('/course-program?courseId=c1')
    expect(await screen.findByTestId('kurs-preview')).toHaveTextContent('Смотреть как ученик')
  })
})
