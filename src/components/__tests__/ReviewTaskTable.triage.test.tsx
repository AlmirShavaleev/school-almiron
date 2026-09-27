import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { GREENS_STORAGE_KEY, ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §238. Светофор таблицы проверки: жёлтые — сверху с причиной, зелёные
 * («ИИ: верно, ответ совпал с эталоном») свёрнуты одной плашкой. Данные — как
 * в утверждённом макете: 14 заданий, 3 жёлтых, 11 зелёных.
 */

const AI_TASKS: AiTaskRow[] = [
  ...['1', '2', '3', '4', '6', '7', '8', '10', '11', '13', '14'].map(no => ({
    no, verdict: 'correct' as const, student_answer: `${no}0`, expected_answer: `${no}0`, note: '',
  })),
  { no: '5', verdict: 'partial', student_answer: '4π; 3π; 15π/4', expected_answer: '4π; 3π; 15π/4', note: 'Неверный отбор: x=3π не входит в [5π/2; 4π]' },
  { no: '9', verdict: 'wrong', student_answer: '−3,8', expected_answer: '−4,5', note: '' },
  { no: '12', verdict: 'unchecked', student_answer: '', expected_answer: '0,125', note: 'не разобрал почерк на фото 2' },
]

const job = (tasks: AiTaskRow[] = AI_TASKS): AiJobRow => ({
  id: 'j1', attempt_id: 'a1', status: 'done', provider: 'openrouter', model: 'm', readable: true,
  suggested_score: 4, confidence: 'high', summary: 'Разбор', last_error: null,
  reference_state: 'used', reference_chars: 4200, worksheet_state: 'used', worksheet_chars: 900,
  tasks, dropped_findings: 0, accepted_at: null,
  created_at: '2026-09-27T10:00:00Z', completed_at: '2026-09-27T10:01:00Z',
})

/** Таблица преподавателя — как её заполняет §238: у №5 уже «верно» с сомнением ИИ. */
const ROWS: ReviewTaskRow[] = Array.from({ length: 14 }, (_v, i) => {
  const no = String(i + 1)
  const ai = AI_TASKS.find(t => t.no === no)!
  const doubt = no === '5'
  return {
    id: `r${no}`, attempt_id: 'a1', no,
    verdict: doubt ? 'correct' : ai.verdict,
    student_answer: ai.student_answer || null, expected_answer: ai.expected_answer || null,
    note: doubt ? `ИИ сомневается: ${ai.note}` : ai.note || null,
    position: (i + 1) * 10, updated_by: null, updated_at: '2026-09-27T10:05:00Z',
  }
})

function table(props: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  const onPatchTask = vi.fn(async () => true)
  const utils = render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={ROWS}
      gradeScale="five"
      onPatchTask={onPatchTask}
      onRemoveTask={vi.fn(async () => true)}
      onAddTask={vi.fn(async () => true)}
      triage
      {...props}
    />,
  )
  return { ...utils, onPatchTask }
}

const visibleNos = () => screen.queryAllByTestId('review-task-row').map(r => r.dataset.no)

describe('§238. светофор в таблице заданий', () => {
  beforeEach(() => { localStorage.clear() })

  it('сверху «Проверьте · 3», «частично при совпавшем ответе» первым, зелёные свёрнуты', () => {
    table()
    expect(screen.getByTestId('triage-yellow-title')).toHaveTextContent('Проверьте · 3')
    expect(visibleNos()).toEqual(['5', '9', '12'])
    const fold = screen.getByTestId('triage-green-fold')
    expect(fold).toHaveAttribute('aria-expanded', 'false')
    expect(fold).toHaveTextContent('11 заданий — ИИ: верно, ответ совпал с эталоном')
    expect(fold).toHaveTextContent('Показать ↓')
  })

  it('сводка «3 проверить · 11 ИИ: верно»', () => {
    table()
    expect(screen.getByTestId('triage-summary')).toHaveTextContent('3 проверить')
    expect(screen.getByTestId('triage-summary')).toHaveTextContent('11 ИИ: верно')
  })

  it('у жёлтой строки — причина одной строкой, у ложной претензии — проверка кодом', () => {
    table()
    const five = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '5')!
    const note = within(five).getByTestId('review-task-triage')
    expect(note).toHaveAttribute('data-reason', 'partial_equal')
    expect(note).toHaveTextContent('ИИ: «частично», но ответ совпал с эталоном')
    expect(within(five).getByTestId('review-task-rootcheck'))
      .toHaveTextContent('Система проверила: 3π входит в [5π/2; 4π] — претензия, скорее всего, ложная.')
    // Таблица уже «верно» — предлагать нечего.
    expect(within(five).queryByTestId('review-task-accept-suggested')).toBeNull()
    // №5 выбрана (первая жёлтая); заметка «ИИ сомневается» спором вердикта
    // и замечания не считается — сомнение уже показал светофор.
    expect(five).toHaveAttribute('data-selected', 'true')
    expect(within(five).queryByTestId('review-task-conflict')).toBeNull()

    const nine = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '9')!
    expect(within(nine).getByTestId('review-task-triage')).toHaveTextContent('ИИ: «неверно» — ответ не совпал.')
    const twelve = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '12')!
    expect(within(twelve).getByTestId('review-task-triage')).toHaveTextContent('не разобрал почерк на фото 2')
  })

  it('плашка раскрывает и сворачивает зелёные', () => {
    table()
    fireEvent.click(screen.getByTestId('triage-green-fold'))
    expect(visibleNos()).toHaveLength(14)
    expect(visibleNos().slice(0, 3)).toEqual(['5', '9', '12'])
    expect(screen.getByTestId('triage-green-fold')).toHaveTextContent('Свернуть ↑')
    // Зелёная строка — без пояснения.
    const one = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '1')!
    expect(one).toHaveAttribute('data-light', 'green')
    expect(within(one).queryByTestId('review-task-triage')).toBeNull()
    fireEvent.click(screen.getByTestId('triage-green-fold'))
    expect(visibleNos()).toEqual(['5', '9', '12'])
  })

  it('настройка «Зелёные: раскрыты» запоминается и действует при следующем открытии', () => {
    const first = table()
    fireEvent.click(screen.getByTestId('triage-pref-open'))
    expect(localStorage.getItem(GREENS_STORAGE_KEY)).toBe('open')
    expect(visibleNos()).toHaveLength(14)
    first.unmount()
    table()
    expect(visibleNos()).toHaveLength(14)
    expect(screen.getByTestId('triage-pref-open')).toHaveAttribute('aria-pressed', 'true')
  })

  it('хранилище недоступно — по умолчанию свёрнуты, экран не падает', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try {
      table()
      expect(visibleNos()).toEqual(['5', '9', '12'])
    } finally {
      spy.mockRestore()
    }
  })

  it('клавиатура ходит по жёлтым, а после раскрытия — и по зелёным', () => {
    const { onPatchTask } = table()
    const list = screen.getByTestId('review-tasks-list')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: '2' })
    expect(onPatchTask).toHaveBeenLastCalledWith('r5', { verdict: 'wrong' })
    // Курсор ушёл на №9, ещё раз вниз — №12, дальше некуда: зелёные свёрнуты.
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: '1' })
    expect(onPatchTask).toHaveBeenLastCalledWith('r12', { verdict: 'correct' })

    fireEvent.click(screen.getByTestId('triage-green-fold'))
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: '2' })
    expect(onPatchTask).toHaveBeenLastCalledWith('r1', { verdict: 'wrong' })
  })

  it('Enter на плашке раскрывает её, а не заводит замечание', () => {
    const onStartNote = vi.fn()
    table({ onStartNote })
    const fold = screen.getByTestId('triage-green-fold')
    fireEvent.keyDown(fold, { key: 'Enter' })
    expect(onStartNote).not.toHaveBeenCalled()
  })

  it('старая таблица с «частично» при совпавшем ответе: предложено «верно», ставит только нажатие', () => {
    const rows = ROWS.map(r => (r.no === '5' ? { ...r, verdict: 'partial' as const, note: AI_TASKS.find(t => t.no === '5')!.note } : r))
    const { onPatchTask } = table({ tasks: rows })
    expect(onPatchTask).not.toHaveBeenCalled()
    const five = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '5')!
    const accept = within(five).getByTestId('review-task-accept-suggested')
    expect(accept).toHaveTextContent('Поставить «верно»')
    fireEvent.click(accept)
    expect(onPatchTask).toHaveBeenCalledWith('r5', { verdict: 'correct' })
  })

  it('правка вердикта не переносит строку между группами', () => {
    const rows = ROWS.map(r => (r.no === '9' ? { ...r, verdict: 'correct' as const } : r))
    table({ tasks: rows })
    expect(visibleNos()).toEqual(['5', '9', '12'])
  })

  it('фильтр по вердикту — прежний плоский список без групп', () => {
    table()
    fireEvent.click(screen.getByTestId('review-tasks-filter-correct'))
    expect(screen.queryByTestId('triage-green-fold')).toBeNull()
    // По таблице «верно» — 11 зелёных и №5 (он «верно» с сомнением ИИ).
    expect(visibleNos()).toHaveLength(12)
  })

  it('задание, которого нет в таблице ИИ, — жёлтое', () => {
    const extra: ReviewTaskRow = { ...ROWS[0], id: 'r15', no: '15', position: 150, student_answer: '1', expected_answer: '1' }
    table({ tasks: [...ROWS, extra] })
    const row = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '15')!
    expect(within(row).getByTestId('review-task-triage')).toHaveTextContent('Этого задания нет в таблице ИИ')
  })

  it('без таблицы ИИ светофора нет — список как до §238', () => {
    table({ job: job([]) })
    expect(screen.queryByTestId('triage-strip')).toBeNull()
    expect(visibleNos()).toHaveLength(14)
  })

  it('все зелёные — «Сомнительных заданий нет»', () => {
    const tasks = AI_TASKS.map(t => ({ ...t, verdict: 'correct' as const, student_answer: 'x', expected_answer: 'x' }))
    const rows = ROWS.map(r => ({ ...r, verdict: 'correct' as const, student_answer: 'x', expected_answer: 'x' }))
    table({ job: job(tasks), tasks: rows })
    expect(screen.getByTestId('triage-yellow-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('review-tasks-empty')).toBeNull()
  })

  it('рамка у задания из свёрнутых зелёных раскрывает их и выбирает задание', () => {
    const notes = [{ id: 'n1', taskNo: '7', text: 'замечание', page: 1, type: 'error' as const, categoryLabel: 'Ошибка' }]
    table({ notes, activeNoteId: 'n1' })
    expect(screen.getByTestId('triage-green-fold')).toHaveAttribute('aria-expanded', 'true')
    const seven = screen.getAllByTestId('review-task-row').find(r => r.dataset.no === '7')!
    expect(seven).toHaveAttribute('data-selected', 'true')
  })
})
