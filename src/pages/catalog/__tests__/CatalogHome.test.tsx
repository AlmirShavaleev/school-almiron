import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { normalizeCatalogOverview, type CatalogOverview } from '@/lib/catalogOverview'

/**
 * §246. Главная «Каталога заданий» глазами ученика (три состояния) и
 * персонала. Функция базы подменена хуком; всё остальное — настоящее:
 * CatalogPage → CatalogHome → lib/catalogOverview.
 */

const state = vi.hoisted(() => ({
  role: 'student' as string,
  hook: { overview: null as unknown, loading: false, error: null as string | null, retry: () => {} },
}))

vi.mock('@/hooks/useCatalogOverview', () => ({ useCatalogOverview: () => state.hook }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const s = { profile: { id: 'u-1', role: state.role } }
    return selector ? selector(s) : s
  },
}))
// Список разделов экзамена здесь не нужен — только чтобы страница не ходила в базу.
vi.mock('@/hooks/useCatalog', async (orig) => ({
  ...(await orig<typeof import('@/hooks/useCatalog')>()),
  useCatalogSections: () => ({ sections: [], loading: false, error: null }),
  useCatalogPhysicsTopicSections: () => ({ sections: [], loading: false, error: null }),
}))

import { CatalogPage } from '@/pages/catalog/CatalogPage'

const n = (spec: Array<[number, number, number?]>, staff = false) =>
  spec.map(([num, total, solved]) => ({ n: num, total, solved: staff ? null : (solved ?? 0), section_id: `sec-${num}` }))

function raw(kind: 'active' | 'few' | 'new' | 'staff') {
  const staff = kind === 'staff'
  const s = (v: number) => (kind === 'new' ? 0 : v)
  return {
    viewer: staff ? 'staff' : 'student',
    min_solvers: 10,
    overall: staff ? null : {
      solved: s(41), solved_7d: s(18), solvers: kind === 'few' ? 5 : kind === 'new' ? 0 : 23,
      better_pct: kind === 'active' ? 68 : null,
    },
    exams: [
      { subject: 'Математика', exam_type: 'ЕГЭ', is_mine: !staff, total: 1714, solved: s(33), solved_7d: s(7),
        solvers: kind === 'few' ? 5 : 23, better_pct: kind === 'active' ? 72 : null,
        numbers: n([[1, 1036, s(24)], [2, 255, s(9)], [12, 423, 0]], staff) },
      { subject: 'Математика', exam_type: 'ОГЭ', is_mine: false, total: 480, solved: 0, solved_7d: 0, solvers: null, better_pct: null,
        numbers: n([[1, 480]], staff) },
      { subject: 'Физика', exam_type: 'ЕГЭ', is_mine: !staff, total: 279, solved: s(8), solved_7d: s(11),
        solvers: kind === 'few' ? 5 : 14, better_pct: kind === 'active' ? 64 : null,
        numbers: n([[1, 146, s(8)], [2, 133, 0]], staff) },
      { subject: 'Физика', exam_type: 'ОГЭ', is_mine: false, total: 501, solved: 0, solved_7d: 0, solvers: null, better_pct: null,
        numbers: n([[1, 126], [20, 375]], staff) },
    ],
  }
}

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function renderHome(kind: 'active' | 'few' | 'new' | 'staff') {
  state.role = kind === 'staff' ? 'teacher' : 'student'
  state.hook = { overview: normalizeCatalogOverview(raw(kind)) as CatalogOverview, loading: false, error: null, retry: vi.fn() }
  return render(
    <MemoryRouter initialEntries={['/catalog']}>
      <Routes>
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/catalog/:sectionId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const card = (exam: string) => screen.getAllByTestId('exam-card').find(c => c.getAttribute('data-exam') === exam)!

describe('CatalogHome — ученик', () => {
  beforeEach(() => vi.clearAllMocks())

  it('активный: итог, место в школе, строки предметов, свои/чужие экзамены', () => {
    renderHome('active')
    const summary = screen.getByTestId('catalog-summary')
    expect(summary).toHaveAttribute('data-state', 'active')
    expect(within(summary).getByTestId('summary-solved')).toHaveTextContent('41')
    expect(within(summary).getByText('задача решена')).toBeInTheDocument()
    expect(within(summary).getByTestId('summary-chips')).toHaveTextContent('+18 за неделю')
    expect(within(summary).getByTestId('summary-chips')).toHaveTextContent('сильнее всего: математика №1')
    // Свои — математика ЕГЭ (не начат №12) и физика ЕГЭ (не начат №2).
    expect(within(summary).getByTestId('summary-chips')).toHaveTextContent('не начаты: 2 номера')
    expect(within(summary).getByTestId('summary-rank')).toHaveTextContent('больше, чем 68 %')
    expect(within(summary).getByTestId('summary-rank')).toHaveTextContent('учеников школы, которые решают в каталоге ЕГЭ')

    expect(screen.getAllByTestId('subject-row').map(r => r.getAttribute('data-subject'))).toEqual(['Математика', 'Физика'])
    expect(screen.getAllByTestId('exam-card').map(c => [c.getAttribute('data-exam'), c.getAttribute('data-dim')])).toEqual([
      ['Математика ЕГЭ', 'false'], ['Математика ОГЭ', 'true'], ['Физика ЕГЭ', 'false'], ['Физика ОГЭ', 'true'],
    ])

    const math = card('Математика ЕГЭ')
    expect(within(math).getByText('решено из 1 714')).toBeInTheDocument()
    expect(within(math).getByTestId('exam-chips')).toHaveTextContent('больше, чем 72 % школы')
    expect(within(math).getByTestId('exam-chips')).toHaveTextContent('не начато: 1 номер')
    expect(within(math).getAllByTestId('number-bar').map(b => b.getAttribute('data-on'))).toEqual(['true', 'true', 'false'])
    expect(within(math).getByRole('link', { name: 'Продолжить: Математика ЕГЭ' })).toHaveAttribute('href', '/catalog?subject=math&exam=ege')
    expect(within(card('Физика ОГЭ')).getByRole('link', { name: 'Начать: Физика ОГЭ' })).toHaveAttribute('href', '/catalog?subject=physics&exam=oge')
    expect(within(card('Физика ОГЭ')).getByTestId('exam-chips')).toHaveTextContent('не твой экзамен — можно потренироваться')
  })

  it('подсказка столбика по наведению и фокусу, нажатие — в номер', () => {
    renderHome('active')
    const bars = within(card('Математика ЕГЭ')).getAllByTestId('number-bar')
    fireEvent.mouseEnter(bars[0])
    expect(screen.getByTestId('bar-tip')).toHaveTextContent('№1 · решено 24 из 1 036')
    fireEvent.focus(bars[2])
    expect(screen.getByTestId('bar-tip')).toHaveTextContent('№12 · не начат · 423 задачи')
    fireEvent.blur(bars[2])
    expect(screen.queryByTestId('bar-tip')).toBeNull()
    fireEvent.click(bars[1])
    expect(screen.getByTestId('where')).toHaveTextContent('/catalog/sec-2?subject=math&exam=ege')
  })

  it('мало сравнения: вместо процента — когда появится, у экзамена — «10+»', () => {
    renderHome('few')
    expect(screen.getByTestId('summary-rank')).toHaveTextContent(
      'Сравнение появится, когда в каталоге будут решать хотя бы 10 учеников школы (сейчас 5)')
    expect(within(card('Математика ЕГЭ')).getByTestId('exam-chips')).toHaveTextContent('сравнение — когда решающих будет 10+')
    expect(screen.queryByText(/больше, чем/)).toBeNull()
  })

  it('новичок: «0 задач решено», подсказка, «Начать» у всех экзаменов, столбики серые', () => {
    renderHome('new')
    const summary = screen.getByTestId('catalog-summary')
    expect(summary).toHaveAttribute('data-state', 'new')
    expect(within(summary).getByTestId('summary-solved')).toHaveTextContent('0')
    expect(within(summary).getByText('задач решено')).toBeInTheDocument()
    expect(within(summary).getByText(/Открой номер, реши задачу и нажми «Выполнено»/)).toBeInTheDocument()
    expect(within(summary).getByTestId('summary-rank')).toHaveTextContent('Сравнение со школой появится после первых решённых задач')
    expect(screen.queryByTestId('summary-chips')).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Начать:/ })).toHaveLength(4)
    expect(screen.getAllByTestId('number-bar').every(b => b.getAttribute('data-on') === 'false')).toBe(true)
    expect(within(card('Математика ЕГЭ')).getByTestId('exam-chips')).toHaveTextContent('пока ничего не отмечено')
  })
})

describe('CatalogHome — персонал', () => {
  it('без личного: ни итога, ни «решено», ни сравнения; столбики — число задач', () => {
    renderHome('staff')
    expect(screen.queryByTestId('catalog-summary')).toBeNull()
    expect(screen.queryByText(/решено/i)).toBeNull()
    expect(screen.queryByText(/больше, чем|сравнение/i)).toBeNull()
    expect(screen.getAllByText('Задач по номерам')).toHaveLength(4)
    const math = card('Математика ЕГЭ')
    expect(math).toHaveAttribute('data-dim', 'false')
    expect(within(math).getByText('1 714')).toBeInTheDocument()
    expect(within(math).getByText('задач')).toBeInTheDocument()
    expect(within(math).getAllByTestId('number-bar').every(b => b.getAttribute('data-on') === 'true')).toBe(true)
    expect(within(math).getByTestId('exam-chips')).toHaveTextContent('3 номера')
    fireEvent.mouseEnter(within(math).getAllByTestId('number-bar')[0])
    expect(screen.getByTestId('bar-tip')).toHaveTextContent('№1 · 1 036 задач')
    expect(within(math).getByRole('link', { name: 'Открыть номера: Математика ЕГЭ' })).toBeInTheDocument()
  })
})

describe('CatalogHome — пока цифр нет', () => {
  it('загрузка: карточки экзаменов и вход в номера сразу, с числами из DIRECTIONS', () => {
    state.role = 'student'
    state.hook = { overview: null, loading: true, error: null, retry: vi.fn() }
    render(<MemoryRouter initialEntries={['/catalog']}><CatalogPage /></MemoryRouter>)
    expect(screen.getByTestId('summary-skeleton')).toBeInTheDocument()
    expect(screen.getAllByTestId('exam-card')).toHaveLength(4)
    expect(within(card('Математика ЕГЭ')).getByText('9 515')).toBeInTheDocument()
    expect(within(card('Физика ОГЭ')).getByRole('link')).toHaveAttribute('href', '/catalog?subject=physics&exam=oge')
  })

  it('ошибка функции: страница живая, «Повторить» перезапрашивает', () => {
    const retry = vi.fn()
    state.role = 'student'
    state.hook = { overview: null, loading: false, error: 'function catalog_my_overview does not exist', retry }
    render(<MemoryRouter initialEntries={['/catalog']}><CatalogPage /></MemoryRouter>)
    expect(screen.getByTestId('catalog-home-error')).toHaveTextContent('Не удалось загрузить статистику')
    expect(screen.getAllByTestId('exam-card')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
