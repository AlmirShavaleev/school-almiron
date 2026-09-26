import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiFindingRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { ReviewNote } from '@/lib/reviewNotes'

/**
 * §226. Список заданий экрана проверки v2: строка — метка, номер, ответ и
 * вклад в балл; выбранное задание раскрыто — эталон, замечания, предложение
 * ИИ и сегмент вердикта. Вердикт ставит только человек: сегмент и клавиши
 * зовут `onPatchTask`, ИИ сюда ничего не пишет.
 */

const row = (no: string, verdict: ReviewTaskRow['verdict'], over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: `r${no}`,
  attempt_id: 'a1',
  no,
  verdict,
  student_answer: null,
  expected_answer: null,
  note: null,
  position: Number(no) * 10,
  updated_by: null,
  updated_at: '2026-09-19T10:05:00Z',
  ...over,
})

const ROWS = [
  row('1', 'correct', { student_answer: '12', expected_answer: '12' }),
  row('3', 'partial', { student_answer: '−3π/2', expected_answer: '−3π/2; −7π/6' }),
  row('6', 'unchecked'),
]

const finding: AiFindingRow = {
  id: 'f1', job_id: 'j1', file_id: 'file1', page: 1,
  rect_x: 0.1, rect_y: 0.1, rect_w: 0.2, rect_h: 0.1,
  category: 'calc', text: 'Корень −7π/6 не отобран', position: 0, task: '3',
}

const note: ReviewNote = {
  id: 'n1', taskNo: '3', text: 'не отобран −7π/6', page: 1, type: 'error', categoryLabel: 'Ошибка',
}

function table(over: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  const onPatchTask = vi.fn(async () => true)
  const view = render(
    <ReviewTaskTable
      job={null}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={ROWS}
      gradeScale="five"
      onPatchTask={onPatchTask}
      onRemoveTask={vi.fn(async () => true)}
      onAddTask={vi.fn(async () => true)}
      {...over}
    />,
  )
  return { ...view, onPatchTask }
}

const rowByNo = (no: string) => screen.getAllByTestId('review-task-row').find(r => r.dataset.no === no)!
const pick = (no: string) => fireEvent.click(within(rowByNo(no)).getByTestId('review-task-pick'))

describe('§226 — выбранное задание', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('в строке — вклад в балл: 1 / 1, ½ / 1, ? / 1', () => {
    table()
    expect(within(rowByNo('1')).getByTestId('review-task-points')).toHaveTextContent('1 / 1')
    expect(within(rowByNo('3')).getByTestId('review-task-points')).toHaveTextContent('½ / 1')
    expect(within(rowByNo('6')).getByTestId('review-task-points')).toHaveTextContent('? / 1')
  })

  it('раскрыто одно задание; клик по строке переносит выбор', () => {
    table()
    expect(rowByNo('1').dataset.selected).toBe('true')
    pick('3')
    expect(rowByNo('1').dataset.selected).toBeUndefined()
    expect(rowByNo('3').dataset.selected).toBe('true')
    const detail = within(rowByNo('3')).getByTestId('review-task-detail')
    expect(detail).toHaveTextContent('Задание 3')
    expect(within(detail).getByTestId('review-task-expected')).toHaveTextContent('−3π/2; −7π/6')
    expect(screen.getAllByTestId('review-task-detail')).toHaveLength(1)
  })

  it('под выбранным — замечание ИИ с «взять» и «мимо», у невыбранного — только отметка «ИИ»', () => {
    const onTakeFinding = vi.fn(async () => true)
    const onSkipFinding = vi.fn(async () => true)
    table({ findings: [finding], onTakeFinding, onSkipFinding })
    expect(within(rowByNo('3')).getByTestId('review-task-pick').dataset.hasSuggestion).toBe('true')
    expect(screen.queryByTestId('ai-finding-suggestion')).not.toBeInTheDocument()
    pick('3')
    const plate = within(rowByNo('3')).getByTestId('ai-finding-suggestion')
    expect(plate).toHaveTextContent('Корень −7π/6 не отобран')
    expect(within(plate).getByTestId('ai-finding-take')).toBeInTheDocument()
    expect(within(plate).getByTestId('ai-finding-skip')).toBeInTheDocument()
  })

  it('сегмент ставит вердикт выбранному заданию — только по нажатию человека', () => {
    const { onPatchTask } = table({ findings: [finding], onTakeFinding: vi.fn() })
    pick('3')
    // Предложение ИИ вердикт не трогает.
    expect(onPatchTask).not.toHaveBeenCalled()
    const segment = within(rowByNo('3')).getByTestId('review-task-segment')
    expect(within(segment).getByTestId('review-task-segment-partial')).toHaveAttribute('aria-pressed', 'true')
    expect(within(segment).getByTestId('review-task-segment-partial')).toHaveTextContent('Частично · ½')
    fireEvent.click(within(segment).getByTestId('review-task-segment-wrong'))
    expect(onPatchTask).toHaveBeenCalledWith('r3', { verdict: 'wrong' })
    // Пятерка на месте: редкие вердикты — тихими кнопками под сегментом.
    fireEvent.click(within(segment).getByTestId('review-task-segment-unsolved'))
    expect(onPatchTask).toHaveBeenCalledWith('r3', { verdict: 'unsolved' })
    fireEvent.click(within(segment).getByTestId('review-task-segment-unchecked'))
    expect(onPatchTask).toHaveBeenCalledWith('r3', { verdict: 'unchecked' })
  })

  it('клавиатура ведёт выбор: стрелка вниз раскрывает следующее задание', () => {
    table()
    const list = screen.getByTestId('review-tasks-list')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(rowByNo('3').dataset.selected).toBe('true')
    expect(within(rowByNo('3')).getByTestId('review-task-detail')).toBeInTheDocument()
  })

  it('клик по рамке на фото выбирает её задание', () => {
    const { rerender } = table({ notes: [note] })
    expect(rowByNo('1').dataset.selected).toBe('true')
    rerender(
      <ReviewTaskTable
        job={null} running={false} error={null} onRun={() => {}}
        tasks={ROWS} gradeScale="five" onPatchTask={vi.fn()} notes={[note]} activeNoteId="n1"
      />,
    )
    expect(rowByNo('3').dataset.selected).toBe('true')
  })

  it('выбор задания мышью ведёт фото к его рамке', () => {
    const onFocusNote = vi.fn()
    table({ notes: [note], onFocusNote })
    pick('3')
    expect(onFocusNote).toHaveBeenCalledWith('n1')
  })

  it('«Авторское решение целиком» — ссылка к блоку эталона, если он есть', () => {
    const onShowReference = vi.fn()
    table({ onShowReference })
    fireEvent.click(within(rowByNo('1')).getByTestId('review-task-show-reference'))
    expect(onShowReference).toHaveBeenCalled()
  })

  it('решения у темы нет — и ссылки нет', () => {
    table()
    expect(screen.queryByTestId('review-task-show-reference')).not.toBeInTheDocument()
  })
})
