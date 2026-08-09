import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SchoolActivity } from '@/components/admin/SchoolActivity'
import type { ActivityDay, DormantStudent, HomeworkFunnelRow, UnopenedTopic, ViewHealth } from '@/hooks/useSchoolAnalytics'

const BASE = {
  dormant: [] as DormantStudent[],
  activity: [] as ActivityDay[],
  unopened: [] as UnopenedTopic[],
  funnel: [] as HomeworkFunnelRow[],
  viewHealth: { views_7d: 0, views_total: 0, first_day: null } as ViewHealth,
  hasViewData: false,
  loading: false,
  error: null as string | null,
}

const dormant = (over: Partial<DormantStudent> & { student_id: string }): DormantStudent => ({
  profile_id: 'p', full_name: 'Иван Петров', course_titles: 'Физика ЕГЭ',
  last_active: '2026-07-20', days_silent: 19, never_active: false,
  ...over,
})

function renderActivity(over: Partial<typeof BASE> = {}) {
  return render(<SchoolActivity {...BASE} {...over} />)
}

describe('SchoolActivity', () => {
  it('отказ показывается словами, а не пустотой', () => {
    renderActivity({ error: 'Статистику видит тот, кто ведёт хотя бы один курс' })
    expect(screen.getByText('Статистику видит тот, кто ведёт хотя бы один курс')).toBeInTheDocument()
    expect(screen.queryByTestId('school-activity')).not.toBeInTheDocument()
  })

  it('«кто пропал» стоит первым блоком — он единственный подсказывает действие', () => {
    renderActivity({ activity: [{ day: '2026-08-08', people: 2 }] })
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings[0]).toMatch(/Кто пропал/)
  })

  it('подписывает, с какой даты вообще ведётся учёт заходов', () => {
    renderActivity()
    expect(screen.getByText(/Учёт заходов ведётся с 04\.08/)).toBeInTheDocument()
  })

  it('пропавшего показывает с числом дней молчания', () => {
    renderActivity({ dormant: [dormant({ student_id: 's1', days_silent: 19 })] })
    expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText(/молчит 19 дн/)).toBeInTheDocument()
  })

  it('«ни разу не заходил» — отдельное состояние, а не ноль дней', () => {
    renderActivity({
      dormant: [dormant({ student_id: 's1', last_active: null, days_silent: null, never_active: true })],
    })
    expect(screen.getByText('ни разу не заходил')).toBeInTheDocument()
    expect(screen.queryByText(/молчит/)).not.toBeInTheDocument()
  })

  it('пустой список пропавших — это хорошая новость, а не пустой блок', () => {
    renderActivity()
    expect(screen.getByText(/Пропавших нет/)).toBeInTheDocument()
  })

  it('пока просмотры не логируются, «что не открывают» честно молчит', () => {
    renderActivity({
      hasViewData: false,
      unopened: [{
        topic_id: 't1', topic_title: 'Кинематика', course_title: 'Физика ЕГЭ',
        total_items: 12, unopened: 12, has_data: false,
      }],
    })
    // Показать 12 «неоткрытых» при пустом учёте значило бы выдать артефакт
    // за ответ — блок обязан молчать, даже когда строки пришли.
    expect(screen.getByText(/Данных пока нет/)).toBeInTheDocument()
    expect(screen.queryByText('Кинематика')).not.toBeInTheDocument()
  })

  it('с накопленными данными «что не открывают» показывает темы', () => {
    renderActivity({
      hasViewData: true,
      unopened: [{
        topic_id: 't1', topic_title: 'Кинематика', course_title: 'Физика ЕГЭ',
        total_items: 12, unopened: 5, has_data: true,
      }],
    })
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.getByText('5 из 12')).toBeInTheDocument()
  })

  it('воронка показывает три числа по курсу', () => {
    renderActivity({
      funnel: [{ course_id: 'c1', course_title: 'Физика ЕГЭ', expected: 40, submitted: 25, accepted: 18 }],
    })
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  // Клиентский вызов record_material_view глушит любую ошибку, чтобы не мешать
  // ученику открыть файл. Значит разъехавшийся контракт молчит, и эта строка —
  // единственный признак поломки.
  it('счётчик открытий виден и подписан датой начала учёта', () => {
    renderActivity({ viewHealth: { views_7d: 12, views_total: 40, first_day: '2026-08-08' } })
    const line = screen.getByTestId('view-health')
    expect(line).toHaveTextContent('Записано открытий за 7 дней: 12')
    expect(line).toHaveTextContent('всего 40')
    expect(line).toHaveTextContent('учёт открытий ведётся с 08.08')
  })

  it('ноль открытий подписан как признак поломки, а не как «мало»', () => {
    renderActivity({ viewHealth: { views_7d: 0, views_total: 0, first_day: null } })
    expect(screen.getByTestId('view-health')).toHaveTextContent(/ноль здесь означает, что учёт не пишется/)
  })

  it('при живом учёте тревожной подписи нет', () => {
    renderActivity({ viewHealth: { views_7d: 3, views_total: 3, first_day: '2026-08-08' } })
    expect(screen.getByTestId('view-health')).not.toHaveTextContent(/не пишется/)
  })

  it('счётчик виден и когда «что не открывают» ещё молчит', () => {
    // Иначе поломку учёта нечем заметить ровно в тот период, когда она
    // вероятнее всего и случится — сразу после врезки.
    renderActivity({ hasViewData: false })
    expect(screen.getByText(/Данных пока нет/)).toBeInTheDocument()
    expect(screen.getByTestId('view-health')).toBeInTheDocument()
  })

  it('месяц без заходов говорит об этом, а не рисует пустой график', () => {
    renderActivity({ activity: [{ day: '2026-08-08', people: 0 }] })
    expect(screen.getByText(/За месяц заходов не было/)).toBeInTheDocument()
  })
})
