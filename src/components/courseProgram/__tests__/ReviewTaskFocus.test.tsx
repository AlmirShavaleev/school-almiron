/**
 * §248. Панель одного задания на спокойном экране проверки.
 *
 * Поведение: цвет клетки в полосе номеров — вердикт, синяя точка — у ИИ есть
 * подсказка, обводка — текущее; клавиши 1/2/3 ставят вердикт текущему и
 * уводят к следующему, ←/→ ходят по заданиям, а в поле ввода ни то ни другое
 * не срабатывает; вердикт пишется тем же `onPatchTask(id, { verdict })`, что
 * у таблицы (§199); «Не решено» — в «…» задания; «+ Замечание ученику» пишет
 * поле `note` строки тем же путём.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { ReviewTaskFocus } from '@/components/courseProgram/ReviewTaskFocus'
import type { ReviewTaskRow, ReviewTaskPatch } from '@/lib/homeworkReviewTasks'
import type { AiFindingRow, AiJobRow } from '@/lib/aiHomeworkCheck'
import type { ReviewNote } from '@/lib/reviewNotes'

const row = (no: string, verdict: ReviewTaskRow['verdict'], over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: `r${no}`, attempt_id: 'a1', no, verdict, student_answer: `ответ ${no}`, expected_answer: `эталон ${no}`,
  note: null, position: Number(no) * 10, updated_by: null, updated_at: '2026-09-30T10:00:00Z', ...over,
})

const job: AiJobRow = {
  id: 'j1', attempt_id: 'a1', status: 'done', provider: null, model: null, readable: true,
  suggested_score: 4, confidence: 'medium', summary: 'разбор', last_error: null,
  reference_state: 'used', reference_chars: 10, worksheet_state: 'used', worksheet_chars: 10,
  tasks: [
    { no: '1', verdict: 'correct', student_answer: 'ответ 1', expected_answer: 'эталон 1', note: '' },
    { no: '2', verdict: 'wrong', student_answer: 'ответ 2', expected_answer: 'эталон 2', note: 'знак у второго слагаемого' },
    { no: '3', verdict: 'correct', student_answer: 'ответ 3', expected_answer: 'эталон 3', note: '' },
  ],
  accepted_at: null, created_at: '2026-09-30T09:00:00Z', completed_at: '2026-09-30T09:00:00Z',
}

const finding: AiFindingRow = {
  id: 'fd3', job_id: 'j1', file_id: 'f1', page: 1, rect_x: 0.1, rect_y: 0.1, rect_w: 0.2, rect_h: 0.1,
  category: 'calc', text: 'В задаче 3 потерян корень', position: 0, task: '3',
}

const START: ReviewTaskRow[] = [row('1', 'correct'), row('2', 'wrong'), row('3', 'partial'), row('4', 'unchecked'), row('5', 'unsolved')]

/**
 * Хозяин панели — как на странице: номер текущего задания и строки живут
 * снаружи, правка вердикта меняет строку (оптимистично, как `patchRow`).
 */
function Harness({
  onPatch = vi.fn(), initial = START, notes = [] as ReviewNote[], activeNoteId = null as string | null,
  keyboard = true, onShowReference,
}: {
  onPatch?: (id: string, patch: ReviewTaskPatch) => void
  initial?: ReviewTaskRow[]
  notes?: ReviewNote[]
  activeNoteId?: string | null
  keyboard?: boolean
  onShowReference?: () => void
}) {
  const [rows, setRows] = useState(initial)
  const [current, setCurrent] = useState<string | null>(null)
  return (
    <>
      <span data-testid="current">{current}</span>
      <textarea data-testid="outside-textarea" />
      <ReviewTaskFocus
        tasks={rows}
        job={job}
        findings={[finding]}
        currentNo={current}
        onCurrentChange={setCurrent}
        onPatchTask={(id, patch) => {
          onPatch(id, patch)
          setRows(list => list.map(item => (item.id === id ? { ...item, ...patch } : item)))
        }}
        notes={notes}
        activeNoteId={activeNoteId}
        keyboard={keyboard}
        onShowReference={onShowReference}
        onStartNote={vi.fn()}
        onRemoveTask={vi.fn()}
        onTakeFinding={vi.fn()}
        onSkipFinding={vi.fn()}
      />
    </>
  )
}

const cells = () => screen.getAllByTestId('review-focus-cell')
const cell = (no: string) => cells().find(item => item.dataset.no === no) as HTMLElement
const currentNo = () => screen.getByTestId('current').textContent

describe('§248 — полоса номеров', () => {
  it('цвет клетки — вердикт, непроверенное и «не решено» — нейтральны', () => {
    render(<Harness />)
    expect(cells().map(item => item.dataset.tone)).toEqual(['ok', 'bad', 'part', 'neutral', 'neutral'])
    expect(cell('2')).toHaveAttribute('aria-label', 'Задание 2: неверно, есть подсказка ИИ')
    expect(cell('5')).toHaveAttribute('aria-label', 'Задание 5: не решено')
  })

  it('синяя точка — там, где у ИИ есть заметка или неразобранная находка', () => {
    render(<Harness />)
    const dotted = cells().filter(item => within(item).queryByTestId('review-focus-ai-dot')).map(item => item.dataset.no)
    expect(dotted).toEqual(['2', '3'])
    expect(screen.getByText('точка — есть подсказка ИИ')).toBeInTheDocument()
  })

  it('текущее — обведено; по умолчанию первое; клик по номеру делает его текущим', () => {
    render(<Harness />)
    expect(currentNo()).toBe('1')
    expect(cell('1')).toHaveAttribute('aria-current', 'true')
    fireEvent.click(cell('3'))
    expect(currentNo()).toBe('3')
    expect(cell('3')).toHaveAttribute('aria-current', 'true')
    expect(cell('1')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('review-focus-position')).toHaveTextContent('3 из 5')
  })

  it('сводка под полосой — три основных вердикта', () => {
    render(<Harness />)
    expect(screen.getByTestId('review-focus-legend')).toHaveTextContent('1 верно · 1 частично · 1 неверно')
  })
})

describe('§248 — текущее задание', () => {
  it('ответ ученика и эталон друг под другом, строка «ИИ» — заметка модели', () => {
    render(<Harness />)
    fireEvent.click(cell('2'))
    expect(screen.getByTestId('review-focus-student')).toHaveTextContent('ответ 2')
    expect(screen.getByTestId('review-focus-expected')).toHaveTextContent('эталон 2')
    expect(screen.getByTestId('review-focus-ai')).toHaveTextContent('знак у второго слагаемого')
  })

  it('кнопка вердикта пишет тем же путём, что таблица: onPatchTask(id, { verdict })', () => {
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)
    fireEvent.click(screen.getByTestId('review-focus-verdict-partial'))
    expect(onPatch).toHaveBeenCalledWith('r1', { verdict: 'partial' })
    expect(screen.getByTestId('review-focus-verdict-partial')).toHaveAttribute('aria-pressed', 'true')
    expect(cell('1').dataset.tone).toBe('part')
    // Мышь не уводит к следующему: человек смотрит на то, что нажал.
    expect(currentNo()).toBe('1')
  })

  it('«Не решено» — в «…» задания, клавиши у него нет', () => {
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)
    fireEvent.click(screen.getByTestId('review-focus-task-menu'))
    fireEvent.click(screen.getByTestId('review-focus-verdict-unsolved'))
    expect(onPatch).toHaveBeenCalledWith('r1', { verdict: 'unsolved' })
    expect(screen.getByTestId('review-focus-rare')).toHaveTextContent('не решено')
    fireEvent.keyDown(window, { key: '5' })
    fireEvent.keyDown(window, { key: '4' })
    expect(onPatch).toHaveBeenCalledTimes(1)
  })

  it('«+ Замечание ученику» раскрывает поле и пишет `note` строки на уходе из поля', () => {
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)
    expect(screen.queryByTestId('review-focus-remark')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('review-focus-remark-toggle'))
    const area = screen.getByTestId('review-focus-remark')
    fireEvent.change(area, { target: { value: '  Проверь знак  ' } })
    fireEvent.blur(area)
    expect(onPatch).toHaveBeenCalledWith('r1', { note: 'Проверь знак' })
    expect(screen.getByTestId('review-focus-remark-text')).toHaveTextContent('Проверь знак')
  })

  it('«Решение в эталоне» открывает эталон', () => {
    const onShowReference = vi.fn()
    render(<Harness onShowReference={onShowReference} />)
    fireEvent.click(screen.getByTestId('review-focus-show-reference'))
    expect(onShowReference).toHaveBeenCalled()
  })

  it('«Назад / Дальше» ходят по заданиям и упираются в края', () => {
    render(<Harness />)
    expect(screen.getByTestId('review-focus-prev')).toBeDisabled()
    fireEvent.click(screen.getByTestId('review-focus-next'))
    expect(currentNo()).toBe('2')
    for (let i = 0; i < 6; i += 1) fireEvent.click(screen.getByTestId('review-focus-next'))
    expect(currentNo()).toBe('5')
    expect(screen.getByTestId('review-focus-next')).toBeDisabled()
  })

  it('рамку выбрали на фото — текущим становится её задание', () => {
    const notes: ReviewNote[] = [{ id: 'n3', taskNo: '3', text: 'рамка', page: 1, type: 'error', categoryLabel: 'Ошибка' }]
    const { rerender } = render(<Harness notes={notes} />)
    expect(currentNo()).toBe('1')
    rerender(<Harness notes={notes} activeNoteId="n3" />)
    expect(currentNo()).toBe('3')
    // Рамка задания — в панели, с правкой и «стр. N».
    expect(within(screen.getByTestId('review-focus-frames')).getByTestId('review-task-note')).toHaveTextContent('рамка')
    // И неразобранная находка ИИ по нему — «взять / мимо».
    expect(within(screen.getByTestId('review-focus-frames')).getByTestId('ai-finding-suggestion')).toHaveTextContent('потерян корень')
  })
})

describe('§248 — клавиши', () => {
  it('1/2/3 — верно/частично/неверно текущему, и дальше к следующему', () => {
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onPatch).toHaveBeenLastCalledWith('r1', { verdict: 'wrong' })
    expect(currentNo()).toBe('2')
    fireEvent.keyDown(window, { key: '1' })
    expect(onPatch).toHaveBeenLastCalledWith('r2', { verdict: 'correct' })
    fireEvent.keyDown(window, { key: '3' })
    expect(onPatch).toHaveBeenLastCalledWith('r3', { verdict: 'wrong' })
    expect(currentNo()).toBe('4')
    // Тот же вердикт второй раз не пишется — лишний запрос ни к чему, но
    // курсор всё равно уходит дальше.
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: '3' })
    expect(onPatch).toHaveBeenCalledTimes(3)
    expect(currentNo()).toBe('4')
  })

  it('←/→ — по заданиям', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(currentNo()).toBe('3')
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(currentNo()).toBe('2')
  })

  it('в поле ввода клавиши — буквы, а не команды', () => {
    const onPatch = vi.fn()
    render(<Harness onPatch={onPatch} />)
    const outside = screen.getByTestId('outside-textarea')
    fireEvent.keyDown(outside, { key: '1' })
    fireEvent.keyDown(outside, { key: 'ArrowRight' })
    fireEvent.click(screen.getByTestId('review-focus-remark-toggle'))
    fireEvent.keyDown(screen.getByTestId('review-focus-remark'), { key: '3' })
    expect(onPatch).not.toHaveBeenCalled()
    expect(currentNo()).toBe('1')
  })

  it('с модификатором и при выключенной клавиатуре (открыта таблица, выбрана рамка) — молчат', () => {
    const onPatch = vi.fn()
    const { rerender } = render(<Harness onPatch={onPatch} />)
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    rerender(<Harness onPatch={onPatch} keyboard={false} />)
    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onPatch).not.toHaveBeenCalled()
    expect(currentNo()).toBe('1')
  })
})

describe('§248 — пока заданий нет', () => {
  it('черновика ИИ нет — «Проверить с ИИ» и «+ Задание»', () => {
    const onRun = vi.fn()
    const onAdd = vi.fn()
    render(
      <ReviewTaskFocus tasks={[]} job={null} currentNo={null} onCurrentChange={() => {}} onRun={onRun} onAddTask={onAdd} />,
    )
    expect(screen.getByTestId('review-focus-empty')).toHaveTextContent('Черновика ИИ по этой работе нет')
    fireEvent.click(screen.getByTestId('ai-check-run'))
    fireEvent.click(screen.getByTestId('review-tasks-add'))
    expect(onRun).toHaveBeenCalled()
    expect(onAdd).toHaveBeenCalled()
  })

  it('у ИИ таблица есть, а своей нет — «Взять таблицу ИИ»', () => {
    const onSeed = vi.fn()
    render(<ReviewTaskFocus tasks={[]} job={job} currentNo={null} onCurrentChange={() => {}} onSeedTasks={onSeed} />)
    fireEvent.click(screen.getByTestId('review-tasks-seed'))
    expect(onSeed).toHaveBeenCalled()
  })
})
