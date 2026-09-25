/**
 * §215. Ввод результатов пробника (board/067).
 *
 * Проверяется то, из-за чего за три месяца при девяти пробниках в
 * `mock_exam_results` осталось ноль строк: модалка читала и писала колонку
 * `feedback`, которой в таблице нет. Поэтому тест смотрит не «функция
 * вызвалась», а ЧТО именно уехало в базу и что пришло обратно.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/** Строки `mock_exam_results`, которые «уже лежат» в базе на этот пробник. */
let existing: Record<string, unknown>[] = []
/** Всё, что модалка записала за прогон. */
let upserts: Record<string, unknown>[][] = []
let upsertError: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => Promise.resolve({
            data: [1, 2, 3, 4].map(n => ({
              student_id: `s${n}`,
              students: {
                id: `s${n}`,
                profile_id: `p${n}`,
                profiles: { full_name: `Ученик ${n}`, avatar_url: null },
              },
            })),
            error: null,
          }),
        }
        return chain
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => Promise.resolve({ data: existing, error: null }),
        upsert: (rows: Record<string, unknown>[]) => {
          upserts.push(rows)
          return Promise.resolve({ error: upsertError })
        },
      }
      return chain
    },
  },
}))

const notifyMockExamResult = vi.fn()
vi.mock('@/utils/notify', () => ({
  notifyMockExamResult: (...args: unknown[]) => notifyMockExamResult(...args),
}))

import { MockExamResultsModal } from '@/components/modals/MockExamResultsModal'

const MAX = 100

function open(props: Partial<React.ComponentProps<typeof MockExamResultsModal>> = {}) {
  return render(
    <MockExamResultsModal
      open
      onClose={() => {}}
      onSaved={() => {}}
      examId="e1"
      groupId="g1"
      maxScore={MAX}
      examTitle="Пробник №1"
      {...props}
    />,
  )
}

const scoreInput = (n: number) => screen.getByLabelText(`Общий балл: Ученик ${n}`) as HTMLInputElement
const part1Input = (n: number) => screen.getByLabelText(`Первая часть: Ученик ${n}`) as HTMLInputElement
const part2Input = (n: number) => screen.getByLabelText(`Вторая часть: Ученик ${n}`) as HTMLInputElement
const notesInput = (n: number) => screen.getByLabelText(`Заметка: Ученик ${n}`) as HTMLInputElement
const save = () => screen.getByTestId('mock-exam-save')

async function ready() {
  await screen.findByLabelText('Общий балл: Ученик 1')
}

beforeEach(() => {
  cleanup()
  existing = []
  upserts = []
  upsertError = null
  notifyMockExamResult.mockReset()
})

describe('§215 — сохранение пишет в настоящие колонки', () => {
  it('балл, обе части и заметка уезжают полями таблицы', async () => {
    open()
    await ready()

    fireEvent.change(scoreInput(1), { target: { value: '42' } })
    fireEvent.change(part1Input(1), { target: { value: '20' } })
    fireEvent.change(part2Input(1), { target: { value: '22' } })
    fireEvent.change(notesInput(1), { target: { value: 'вторая часть слабее' } })
    fireEvent.click(save())

    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0]).toEqual([{
      mock_exam_id: 'e1',
      student_id: 's1',
      score: 42,
      part1_score: 20,
      part2_score: 22,
      notes: 'вторая часть слабее',
    }])
    // Той самой колонки, из-за которой ничего не сохранялось, в записи нет.
    expect(Object.keys(upserts[0][0])).not.toContain('feedback')
  })

  it('поле называется заметкой, а не обратной связью', async () => {
    open()
    await ready()
    expect(notesInput(1).placeholder).toContain('Заметка')
    expect(screen.queryByPlaceholderText(/обратн/i)).toBeNull()
  })

  it('пустые строки в базу не едут', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(2), { target: { value: '55' } })
    fireEvent.click(save())

    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(upserts[0].map(r => r.student_id)).toEqual(['s2'])
  })
})

describe('§215 — проверка ввода', () => {
  it('балл выше максимума не сохраняется, а объясняется подписью у поля', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '101' } })
    fireEvent.click(save())

    expect(await screen.findByTestId('mock-exam-row-error')).toHaveTextContent('Не больше 100')
    expect(upserts).toHaveLength(0)
    expect(scoreInput(1).getAttribute('aria-invalid')).toBe('true')
  })

  it('сумма частей больше общего — тоже отказ', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '50' } })
    fireEvent.change(part1Input(1), { target: { value: '30' } })
    fireEvent.change(part2Input(1), { target: { value: '25' } })
    fireEvent.click(save())

    expect(await screen.findByTestId('mock-exam-row-error')).toHaveTextContent('Сумма частей больше общего балла')
    expect(upserts).toHaveLength(0)
  })

  it('ни одна строка не сохраняется, если ошибка хоть в одной', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '40' } })
    fireEvent.change(scoreInput(2), { target: { value: '900' } })
    fireEvent.click(save())

    await screen.findByTestId('mock-exam-row-error')
    expect(upserts).toHaveLength(0)
    expect(screen.getByTestId('mock-exam-save-error')).toHaveTextContent('ничего не сохранено')
    // Введённое у первого ученика на месте — ничего не потеряно.
    expect(scoreInput(1).value).toBe('40')
  })

  it('правка поля снимает ошибку строки', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '101' } })
    fireEvent.click(save())
    await screen.findByTestId('mock-exam-row-error')

    fireEvent.change(scoreInput(1), { target: { value: '99' } })
    expect(screen.queryByTestId('mock-exam-row-error')).toBeNull()
  })

  it('ошибка базы показывается в модалке, а не alert-ом, и ввод остаётся', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    upsertError = { message: 'что-то пошло не так' }
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '40' } })
    fireEvent.click(save())

    expect(await screen.findByTestId('mock-exam-save-error')).toHaveTextContent('что-то пошло не так')
    expect(alertSpy).not.toHaveBeenCalled()
    expect(scoreInput(1).value).toBe('40')
    alertSpy.mockRestore()
  })
})

describe('§215 — уведомления', () => {
  it('шлются только тем, у кого балл появился', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '40' } })
    fireEvent.change(scoreInput(2), { target: { value: '60' } })
    fireEvent.click(save())

    await waitFor(() => expect(notifyMockExamResult).toHaveBeenCalledTimes(2))
    expect(notifyMockExamResult).toHaveBeenCalledWith('p1', 'Пробник №1', 40, MAX)
    expect(notifyMockExamResult).toHaveBeenCalledWith('p2', 'Пробник №1', 60, MAX)
  })

  it('повторное сохранение без изменений не шлёт ничего', async () => {
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '40' } })
    fireEvent.click(save())
    await waitFor(() => expect(notifyMockExamResult).toHaveBeenCalledTimes(1))

    notifyMockExamResult.mockReset()
    fireEvent.click(save())
    await waitFor(() => expect(upserts).toHaveLength(2))
    expect(notifyMockExamResult).not.toHaveBeenCalled()
  })

  it('правка заметки у уже выставленного балла никого не будит', async () => {
    // Тот самый случай: исправил опечатку — и вся группа получила повторное
    // уведомление.
    existing = [
      { student_id: 's1', score: 40, part1_score: null, part2_score: null, notes: 'опечятка' },
      { student_id: 's2', score: 60, part1_score: null, part2_score: null, notes: null },
    ]
    open()
    await ready()
    fireEvent.change(notesInput(1), { target: { value: 'опечатка исправлена' } })
    fireEvent.click(save())

    await waitFor(() => expect(upserts).toHaveLength(1))
    expect(notifyMockExamResult).not.toHaveBeenCalled()
  })

  it('изменённый балл уведомление шлёт — и только ему', async () => {
    existing = [
      { student_id: 's1', score: 40, part1_score: null, part2_score: null, notes: null },
      { student_id: 's2', score: 60, part1_score: null, part2_score: null, notes: null },
    ]
    open()
    await ready()
    fireEvent.change(scoreInput(1), { target: { value: '45' } })
    fireEvent.click(save())

    await waitFor(() => expect(notifyMockExamResult).toHaveBeenCalledTimes(1))
    expect(notifyMockExamResult).toHaveBeenCalledWith('p1', 'Пробник №1', 45, MAX)
  })
})

describe('§215 — сохранение частями подхватывается', () => {
  it('половина группы заполнена — при открытии поля уже заполнены', async () => {
    // Ровно то, что не работало: чтение падало на несуществующей колонке.
    existing = [
      { student_id: 's1', score: 42, part1_score: 20, part2_score: 22, notes: 'вторая часть слабее' },
      { student_id: 's2', score: 71, part1_score: null, part2_score: null, notes: null },
    ]
    open()
    await ready()

    expect(scoreInput(1).value).toBe('42')
    expect(part1Input(1).value).toBe('20')
    expect(part2Input(1).value).toBe('22')
    expect(notesInput(1).value).toBe('вторая часть слабее')

    expect(scoreInput(2).value).toBe('71')
    expect(part1Input(2).value).toBe('')

    // Незаполненные — пустые, а не нули.
    expect(scoreInput(3).value).toBe('')
    expect(scoreInput(4).value).toBe('')
    expect(screen.getByText('2 / 4 заполнено')).toBeInTheDocument()
  })

  it('дозаполнение дописывает строки, не трогая прежние', async () => {
    existing = [{ student_id: 's1', score: 42, part1_score: null, part2_score: null, notes: null }]
    open()
    await ready()

    fireEvent.change(scoreInput(3), { target: { value: '88' } })
    fireEvent.click(save())

    await waitFor(() => expect(upserts).toHaveLength(1))
    const byStudent = Object.fromEntries(upserts[0].map(r => [r.student_id, r.score]))
    expect(byStudent).toEqual({ s1: 42, s3: 88 })
    // Уведомление — только новому: у первого балл тот же.
    expect(notifyMockExamResult).toHaveBeenCalledTimes(1)
    expect(notifyMockExamResult).toHaveBeenCalledWith('p3', 'Пробник №1', 88, MAX)
  })
})
