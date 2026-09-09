import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DormantPanel, LearningPanel } from '@/components/admin/SchoolActivity'
import type { ActivityDay, DormantStudent, HomeworkFunnelRow, UnopenedTopic, ViewHealth } from '@/hooks/useSchoolAnalytics'

/**
 * Четыре среза §107 разъехались по двум вкладкам: «кто пропал» — про людей и
 * живёт на «Учениках», остальные три — про учебный процесс и живут на «Учёбе».
 * Сами блоки не переписаны, поэтому и проверки те же; сменилось только то, из
 * какой панели их спрашивают.
 */

const GATE = { loading: false, error: null as string | null }

const NO_HEALTH: ViewHealth = { views_7d: 0, views_total: 0, first_day: null }

const LEARNING_BASE = {
  activity: [] as ActivityDay[],
  unopened: [] as UnopenedTopic[],
  funnel: [] as HomeworkFunnelRow[],
  viewHealth: NO_HEALTH,
  hasViewData: false,
  ...GATE,
}

const dormant = (over: Partial<DormantStudent> & { student_id: string }): DormantStudent => ({
  profile_id: 'p', full_name: 'Иван Петров', course_titles: 'Физика ЕГЭ',
  last_active: '2026-07-20', days_silent: 19, never_active: false,
  ...over,
})

function renderDormant(over: Partial<{ dormant: DormantStudent[]; loading: boolean; error: string | null }> = {}) {
  return render(<DormantPanel dormant={[]} {...GATE} {...over} />)
}

function renderLearning(over: Partial<typeof LEARNING_BASE> = {}) {
  return render(<LearningPanel {...LEARNING_BASE} {...over} />)
}

describe('SchoolActivity', () => {
  it('отказ показывается словами, а не пустотой — на обеих вкладках', () => {
    const message = 'Статистику видит тот, кто ведёт хотя бы один курс'

    const dormantView = render(<DormantPanel dormant={[]} loading={false} error={message} />)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByTestId('school-activity-dormant')).not.toBeInTheDocument()
    dormantView.unmount()

    render(<LearningPanel {...LEARNING_BASE} error={message} />)
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByTestId('school-activity-learning')).not.toBeInTheDocument()
  })

  it('«кто пропал» стоит отдельно от учебных срезов — это вопрос про людей', () => {
    // Один хук, две вкладки. Если блоки съедутся обратно в одну панель,
    // владелец снова будет искать «кому написать» среди графиков.
    const dormantView = renderDormant()
    expect(screen.getByRole('heading', { level: 3, name: /Кто пропал/ })).toBeInTheDocument()
    expect(screen.queryByText('Заходы по дням')).not.toBeInTheDocument()
    dormantView.unmount()

    renderLearning()
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings).toEqual(['Заходы по дням', 'Воронка ДЗ', 'Что не открывают'])
    expect(screen.queryByText(/Кто пропал/)).not.toBeInTheDocument()
  })

  it('подписывает, с какой даты вообще ведётся учёт заходов', () => {
    renderDormant()
    expect(screen.getByText(/Учёт заходов ведётся с 04\.08/)).toBeInTheDocument()
  })

  it('пропавшего показывает с числом дней молчания', () => {
    renderDormant({ dormant: [dormant({ student_id: 's1', days_silent: 19 })] })
    expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText(/молчит 19 дн/)).toBeInTheDocument()
  })

  it('«ни разу не заходил» — отдельное состояние, а не ноль дней', () => {
    renderDormant({
      dormant: [dormant({ student_id: 's1', last_active: null, days_silent: null, never_active: true })],
    })
    expect(screen.getByText('ни разу не заходил')).toBeInTheDocument()
    expect(screen.queryByText(/молчит/)).not.toBeInTheDocument()
  })

  it('пустой список пропавших — это хорошая новость, а не пустой блок', () => {
    renderDormant()
    expect(screen.getByText(/Пропавших нет/)).toBeInTheDocument()
  })

  it('пока просмотры не логируются, «что не открывают» честно молчит', () => {
    renderLearning({
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
    renderLearning({
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
    renderLearning({
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
    renderLearning({ viewHealth: { views_7d: 12, views_total: 40, first_day: '2026-08-08' } })
    const line = screen.getByTestId('view-health')
    expect(line).toHaveTextContent('Записано открытий за 7 дней: 12')
    expect(line).toHaveTextContent('всего 40')
    expect(line).toHaveTextContent('учёт открытий ведётся с 08.08')
  })

  it('ноль открытий подписан как признак поломки, а не как «мало»', () => {
    renderLearning({ viewHealth: { views_7d: 0, views_total: 0, first_day: null } })
    expect(screen.getByTestId('view-health')).toHaveTextContent(/ноль здесь означает, что учёт не пишется/)
  })

  it('при живом учёте тревожной подписи нет', () => {
    renderLearning({ viewHealth: { views_7d: 3, views_total: 3, first_day: '2026-08-08' } })
    expect(screen.getByTestId('view-health')).not.toHaveTextContent(/не пишется/)
  })

  it('счётчик виден и когда «что не открывают» ещё молчит', () => {
    // Иначе поломку учёта нечем заметить ровно в тот период, когда она
    // вероятнее всего и случится — сразу после врезки.
    renderLearning({ hasViewData: false })
    expect(screen.getByText(/Данных пока нет/)).toBeInTheDocument()
    expect(screen.getByTestId('view-health')).toBeInTheDocument()
  })

  it('месяц без заходов говорит об этом, а не рисует пустой график', () => {
    renderLearning({ activity: [{ day: '2026-08-08', people: 0 }] })
    expect(screen.getByText(/За месяц заходов не было/)).toBeInTheDocument()
  })
})
