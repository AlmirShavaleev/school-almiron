import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §244 (заменяет проверки полки копий §113–§115). Страница «Курсы» у учителя:
 * классы строками, программы, шаблоны с «＋ Класс», прочие курсы, архив и
 * полоса «что требует внимания». Раскладку и подписи проверяет
 * `lib/__tests__/coursesOverview.test.ts`; здесь — что страница это рисует,
 * ходит в базу одним вызовом и переживает её отказ.
 */

const saveCourseSpy = vi.fn()
const rpcSpy = vi.fn()

function makeChain(result: { data: unknown; error: { message?: string } | null }) {
  const chain: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

const course = (over: Record<string, unknown>) => ({
  id: 'x', title: 'x', subject: 'physics', exam_type: 'ege', description: null,
  price: 0, duration_weeks: 36, is_active: true, is_draft: false,
  is_template: false, copied_from_course_id: null, owner_id: 'teacher-1',
  start_date: null, end_date: null, enrollment_open_until: null,
  ...over,
})

const COURSES = [
  course({ id: 'tpl', title: 'Физика ЕГЭ Шаблон', is_template: true }),
  course({ id: 'mtpl', title: 'Математика ЕГЭ. 1 часть', subject: 'math', is_template: true }),
  // Как на проде: свежая копия — неактивный ЧЕРНОВИК; в архив она не уезжает.
  course({ id: 'copy', title: 'Физика ЕГЭ Шаблон 11А класс', is_draft: true, is_active: false, copied_from_course_id: 'tpl' }),
  course({ id: 'mcopy', title: 'Математика ЕГЭ. 1 часть 11А', subject: 'math', copied_from_course_id: 'mtpl' }),
  course({ id: 'copy10', title: 'Физика ЕГЭ Шаблон 10А', copied_from_course_id: 'tpl' }),
  course({ id: 'plain', title: 'Курс сам по себе' }),
  course({ id: 'old', title: 'Убранный курс', is_active: false }),
]

const row = (course_id: string, over: Record<string, unknown> = {}) => ({
  course_id, students: 0, student_ids: [], topics: 0, open_topics: 0, modules: 0,
  pending: 0, subs_7d: 0, next_open: null, next_open_count: 0, ...over,
})
const OVERVIEW = [
  row('tpl', { topics: 170, modules: 7 }),
  row('mtpl', { topics: 86, modules: 16 }),
  row('copy', { students: 11, student_ids: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11'], topics: 170, open_topics: 60, pending: 1, subs_7d: 5 }),
  row('mcopy', { students: 3, student_ids: ['s1', 's2', 'm3'], topics: 86, open_topics: 58, pending: 16, subs_7d: 49, next_open: '2026-11-09', next_open_count: 1 }),
  row('copy10', { students: 2, student_ids: ['t1', 't2'], topics: 170, open_topics: 9 }),
  row('plain', { topics: 1 }),
]

let currentCourses: ReturnType<typeof course>[] = COURSES
let currentProfile = { id: 'teacher-1', role: 'teacher' }
let profilesRows: { id: string; full_name: string }[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeChain({ data: table === 'profiles' ? profilesRows : [], error: null }),
    rpc: (fn: string, args: unknown) => rpcSpy(fn, args),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: currentProfile }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), saved: vi.fn() },
}))

vi.mock('@/hooks/useCourseProgram', () => ({
  useCourseProgram: () => ({
    courses: currentCourses,
    loading: false,
    reload: vi.fn(),
    loadModules: vi.fn().mockResolvedValue([]),
    saveCourse: (...args: unknown[]) => saveCourseSpy(...args),
    createCourse: vi.fn(),
    saveModule: vi.fn(), createModule: vi.fn(), deleteModule: vi.fn(),
    saveTopic: vi.fn(), createTopic: vi.fn(), deleteTopic: vi.fn(),
  }),
}))

vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({ useCourseHomeworkTemplates: () => ({ templates: [] }) }))
vi.mock('@/components/modals/TopicMaterialsModal', () => ({ TopicMaterialsModal: () => null }))
vi.mock('@/components/modals/AddLessonTemplateToCourseModal', () => ({ AddLessonTemplateToCourseModal: () => null }))

import { CourseProgramPage } from '@/pages/CourseProgramPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <CourseProgramPage />
    </MemoryRouter>,
  )
}

const classRows = () => screen.queryAllByTestId('class-row')
const rowName = (el: HTMLElement) => within(el).getByTestId('row-name').textContent

describe('Страница «Курсы» (§244)', () => {
  beforeEach(() => {
    saveCourseSpy.mockReset().mockResolvedValue(undefined)
    rpcSpy.mockReset().mockResolvedValue({ data: OVERVIEW, error: null })
    currentCourses = COURSES
    currentProfile = { id: 'teacher-1', role: 'teacher' }
    profilesRows = []
    try { window.localStorage.clear() } catch { /* нет хранилища — и ладно */ }
  })

  it('цифры — одним вызовом базы по курсам со страницы', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const calls = rpcSpy.mock.calls.filter(c => c[0] === 'teacher_courses_overview')
    expect(calls).toHaveLength(1)
    expect([...(calls[0][1] as { p_course_ids: string[] }).p_course_ids].sort())
      .toEqual(COURSES.map(c => c.id).sort())
  })

  it('по умолчанию — по классам: копии разных шаблонов с одним именем класса в одной строке', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const rows = classRows()
    // 11А: 11 + 3 ученика, двое общих ⇒ 12 различных; 10А — 2. Классы — по убыванию учеников.
    // «11А» и «11А класс» — один класс; написания поровну, показывается первое (шаблон математики — первый).
    expect(rows.map(rowName)).toEqual(['11А', '10А'])
    expect(within(rows[0]).getByText('2 курса · 12 учеников')).toBeInTheDocument()

    // Порядок программ в строке — по названиям шаблонов: математика, потом физика.
    const cards = within(rows[0]).getAllByTestId('course-card')
    expect(cards.map(c => c.getAttribute('data-course-id'))).toEqual(['mcopy', 'copy'])
    expect(within(cards[0]).getByText('Математика · 1 часть')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Физика')).toBeInTheDocument()
  })

  it('карточка — настоящая ссылка в курс, полное название — подсказкой', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const card = screen.getAllByTestId('course-card').find(c => c.getAttribute('data-course-id') === 'copy')!
    expect(card.tagName).toBe('A')
    expect(card).toHaveAttribute('href', '/course-program?courseId=copy')
    expect(card).toHaveAttribute('title', 'Физика ЕГЭ Шаблон 11А класс')
    expect(card).not.toHaveAttribute('tabindex', '-1')
  })

  it('на карточке: ученики, открытые темы, чипы проверки/сдач/плана и метка черновика', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const byId = (id: string) => screen.getAllByTestId('course-card').find(c => c.getAttribute('data-course-id') === id)!
    const phys = byId('copy')
    expect(within(phys).getByText('11 учеников')).toBeInTheDocument()
    expect(within(phys).getByText('60 из 170')).toBeInTheDocument()
    expect(within(phys).getByText('1 ждёт проверки')).toBeInTheDocument()
    expect(within(phys).getByText('5 сдач за неделю')).toBeInTheDocument()
    expect(within(phys).getByText('плана нет')).toBeInTheDocument()
    expect(within(phys).getByText('черновик')).toBeInTheDocument()

    const math = byId('mcopy')
    expect(within(math).getByText('16 ждут проверки')).toBeInTheDocument()
    expect(within(math).getByText(/^далее 9 ноя/)).toBeInTheDocument()

    const ten = byId('copy10')
    expect(within(ten).getByText('нет работ на проверке')).toBeInTheDocument()
    expect(within(ten).getByText('0 сдач за неделю')).toBeInTheDocument()
  })

  it('полоса внимания: ждут проверки → очередь, сдачи за 7 дней, ближайшее открытие → план курса', async () => {
    renderPage()
    const strip = await screen.findByTestId('courses-attention')

    const pending = within(strip).getByTestId('attention-pending')
    expect(pending).toHaveAttribute('href', '/homework-queue')
    expect(pending).toHaveTextContent('17')
    expect(pending).toHaveTextContent('работ ждут проверки · 2 курса')
    expect(within(strip).getByTestId('attention-subs')).toHaveTextContent('54сдачи за 7 дней по всем классам')
    const next = within(strip).getByTestId('attention-next')
    expect(next).toHaveAttribute('href', '/course-program/mcopy/plan')
    expect(next).toHaveTextContent('следующее открытие по плану · 11А, Математика · 1 часть')
  })

  it('плана открытия нет ни у одного курса — третьей плитки нет', async () => {
    rpcSpy.mockResolvedValue({ data: OVERVIEW.map(r => ({ ...r, next_open: null })), error: null })
    renderPage()
    const strip = await screen.findByTestId('courses-attention')

    expect(within(strip).queryByTestId('attention-next')).not.toBeInTheDocument()
    expect(within(strip).getByTestId('attention-pending')).toBeInTheDocument()
  })

  it('база не ответила (функции ещё нет) — курсы на месте, без цифр и без полосы', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    renderPage()

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled())
    expect(classRows().map(rowName)).toContain('10А')
    expect(screen.queryByTestId('courses-attention')).not.toBeInTheDocument()
    expect(screen.queryByText(/ждут проверки|нет работ на проверке/)).not.toBeInTheDocument()
  })

  it('«По программам»: строка — шаблон, карточки — его классы; выбор запоминается', async () => {
    const { unmount } = renderPage()
    await screen.findByTestId('courses-attention')

    fireEvent.click(screen.getByRole('button', { name: 'По программам' }))
    expect(screen.getByRole('button', { name: 'По программам' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('courses-by-class')).not.toBeInTheDocument()

    const rows = screen.getAllByTestId('program-row')
    expect(rows.map(rowName)).toEqual(['Математика · 1 часть', 'Физика'])
    expect(within(rows[1]).getByText('шаблон · 170 тем')).toBeInTheDocument()
    const cards = within(rows[1]).getAllByTestId('course-card')
    expect(cards.map(c => c.getAttribute('data-course-id'))).toEqual(['copy', 'copy10'])
    expect(within(cards[0]).getByText('11А')).toBeInTheDocument()

    unmount()
    renderPage()
    expect(screen.getByRole('button', { name: 'По программам' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('program-row')).toHaveLength(2)
  })

  it('хранилище недоступно — вид по классам, переключатель всё равно работает', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    try {
      renderPage()
      await screen.findByTestId('courses-attention')
      expect(screen.getByTestId('courses-by-class')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'По программам' }))
      expect(screen.getByTestId('courses-by-program')).toBeInTheDocument()
    } finally {
      get.mockRestore()
      set.mockRestore()
    }
  })

  it('шаблоны программ: темы и модули, классы ссылками, «Открыть шаблон»', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const tpl = screen.getAllByTestId('template-card').find(c => within(c).queryByText('Физика ЕГЭ Шаблон'))!
    expect(within(tpl).getByText('170 тем · 7 модулей')).toBeInTheDocument()
    expect(within(tpl).getByText('Классы · 2')).toBeInTheDocument()
    const links = within(tpl).getAllByTestId('template-class-link')
    expect(links.map(l => [l.textContent, l.getAttribute('href')])).toEqual([
      ['11А', '/course-program?courseId=copy'],
      ['10А', '/course-program?courseId=copy10'],
    ])
    expect(within(tpl).getByRole('link', { name: 'Открыть шаблон' })).toHaveAttribute('href', '/course-program?courseId=tpl')
  })

  it('«＋ Класс» открывает то же окно копирования курса, что «Скопировать курс…» в настройках', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const tpl = screen.getAllByTestId('template-card').find(c => within(c).queryByText('Физика ЕГЭ Шаблон'))!
    fireEvent.click(within(tpl).getByTestId('template-add-class'))

    const dialog = await screen.findByTestId('copy-course-dialog')
    expect(within(dialog).getByText('Скопировать курс')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('Физика ЕГЭ Шаблон (копия)')).toBeInTheDocument()
  })

  it('ученику «＋ Класс» не показывается', async () => {
    currentProfile = { id: 'teacher-1', role: 'student' }
    renderPage()
    await screen.findByTestId('courses-attention')
    expect(screen.queryByTestId('template-add-class')).not.toBeInTheDocument()
  })

  it('курс без шаблона — в «Других курсах» компактной строкой; архив — под спойлером', async () => {
    renderPage()
    await screen.findByTestId('courses-attention')

    const other = screen.getByTestId('courses-other')
    const plain = within(other).getByRole('link', { name: /Курс сам по себе/ })
    expect(plain).toHaveAttribute('href', '/course-program?courseId=plain')
    expect(plain).toHaveTextContent('физика · 1 тема · без учеников')
    expect(within(other).queryByText('Убранный курс')).not.toBeInTheDocument()

    expect(screen.getByText('Архив · 1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Убранный курс/ })).toHaveAttribute('href', '/course-program?courseId=old')
  })

  it('пустой учитель: «Курсов пока нет», без полосы и без переключателя; база не зовётся', async () => {
    currentCourses = []
    renderPage()

    expect(screen.getByTestId('courses-empty')).toHaveTextContent('Курсов пока нет')
    expect(screen.queryByTestId('courses-attention')).not.toBeInTheDocument()
    expect(screen.queryByTestId('courses-view-toggle')).not.toBeInTheDocument()
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('админ смотрит чужие курсы: имя владельца тихой строкой на чужих, на своих — ничего', async () => {
    currentProfile = { id: 'admin-1', role: 'admin' }
    currentCourses = COURSES.map(c => (c.id === 'copy10' ? { ...c, owner_id: 'admin-1' } : c))
    profilesRows = [{ id: 'teacher-1', full_name: 'Иванова Мария' }, { id: 'admin-1', full_name: 'Админ' }]
    renderPage()
    await screen.findByTestId('courses-attention')

    const byId = (id: string) => screen.getAllByTestId('course-card').find(c => c.getAttribute('data-course-id') === id)!
    await waitFor(() => expect(within(byId('copy')).getByTestId('course-owner')).toHaveTextContent('Иванова Мария'))
    expect(within(byId('copy10')).queryByTestId('course-owner')).not.toBeInTheDocument()
    const tpl = screen.getAllByTestId('template-card').find(c => within(c).queryByText('Физика ЕГЭ Шаблон'))!
    expect(within(tpl).getByTestId('course-owner')).toHaveTextContent('Иванова Мария')
    expect(screen.queryByText('Ваш курс')).not.toBeInTheDocument()
  })

  it('галочка «Это шаблон» сохраняется вместе с остальными настройками', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('link', { name: /Курс сам по себе/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/i }))

    const checkbox = await screen.findByTestId('course-is-template')
    expect(checkbox).not.toBeChecked()
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }))

    await waitFor(() => expect(saveCourseSpy).toHaveBeenCalled())
    expect(saveCourseSpy.mock.calls[0][1]).toMatchObject({ is_template: true })
  })

  it('пояснение под галочкой на месте — иначе «шаблон» читается как право', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('link', { name: /Курс сам по себе/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Настройки/i }))

    expect(await screen.findByText('Шаблон — каркас. Учеников зачисляют в копии, не в шаблон.'))
      .toBeInTheDocument()
  })
})
