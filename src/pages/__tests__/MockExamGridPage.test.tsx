/**
 * §218. Экран «пробник по номерам заданий».
 *
 * Проверяется поведение, ради которого экран устроен так, как устроен:
 *   * красная клетка блокирует сохранение ЦЕЛИКОМ — в базу не уходит ничего;
 *   * «Отменить вставку» возвращает таблицу как была;
 *   * баллы строки, чью фамилию не узнали, не попадают никуда;
 *   * уведомление уходит только тому, у кого итог появился или изменился.
 *
 * База подменена маленькой имитацией `save_mock_exam_grid`: она хранит итоги
 * между сохранениями и отдаёт `old_score` так же, как настоящая функция, —
 * иначе «итог не изменился» проверять было бы не на чем.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Шаблон на четыре задания: №1–2 первая часть по 1 баллу, №3 — 2, №4 — 3.
const TEMPLATE = { id: 't1', title: 'Мини', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 2, 3], part1_last: 2, score_scale: null as number[] | null }
const ROSTER = [
  { id: 's-bel', pid: 'p-bel', name: 'Белов Артём' },
  { id: 's-ivi', pid: 'p-ivi', name: 'Иванов Иван' },
  { id: 's-ivk', pid: 'p-ivk', name: 'Иванов Кирилл' },
  { id: 's-saf', pid: 'p-saf', name: 'Сафин Амир' },
]

let exam: Record<string, unknown> | null
let stored: { student_id: string; task_number: number; points: number }[]
/** Итоги «в базе» — то, что читает отчёт §217 и от чего считается old_score. */
let totalsDb: Map<string, number>
let rpcCalls: { p_mock_exam_id: string; p_rows: { student_id: string; points: (number | null)[] }[] }[]
let rpcError: { message: string } | null

function thenable<T>(value: T) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(value),
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'mock_exams') return thenable({ data: exam, error: exam ? null : { message: 'нет' } })
      if (table === 'group_students') {
        return thenable({
          data: ROSTER.map(r => ({ student_id: r.id, students: { id: r.id, profile_id: r.pid, profiles: { full_name: r.name } } })),
          error: null,
        })
      }
      if (table === 'mock_exam_task_scores') return thenable({ data: stored, error: null })
      throw new Error(`неожиданная таблица ${table}`)
    },
    rpc: (fn: string, args: { p_mock_exam_id: string; p_rows: { student_id: string; points: (number | null)[] }[] }) => {
      if (fn !== 'save_mock_exam_grid') throw new Error(fn)
      rpcCalls.push(JSON.parse(JSON.stringify(args)))
      if (rpcError) return Promise.resolve({ data: null, error: rpcError })
      const rows = args.p_rows.map(r => {
        const filled = r.points.filter((p): p is number => p != null)
        const score = filled.length ? filled.reduce((a, b) => a + b, 0) : null
        const old = totalsDb.get(r.student_id) ?? null
        if (score == null) totalsDb.delete(r.student_id); else totalsDb.set(r.student_id, score)
        return { student_id: r.student_id, old_score: old, score }
      })
      return Promise.resolve({ data: { rows }, error: null })
    },
  },
}))

const notifyMockExamResult = vi.fn()
vi.mock('@/utils/notify', () => ({
  notifyMockExamResult: (...args: unknown[]) => notifyMockExamResult(...args),
}))

import { MockExamGridPage } from '@/pages/MockExamGridPage'

function open() {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/e1']}>
      <Routes><Route path="/mock-exams/:id" element={<MockExamGridPage />} /></Routes>
    </MemoryRouter>,
  )
}

const cell = (name: string, task: number) => screen.getByLabelText(`${name}, задание ${task}`) as HTMLInputElement
const rowValues = (name: string) => [1, 2, 3, 4].map(t => cell(name, t).value)
const nameCell = (name: string) => screen.getAllByTestId('mock-grid-name').find(td => td.textContent?.includes(name))!
const paste = (el: Element, text: string) => fireEvent.paste(el, { clipboardData: { getData: () => text } })
const save = () => fireEvent.click(screen.getByTestId('mock-grid-save'))

beforeEach(() => {
  cleanup()
  exam = { id: 'e1', title: 'Пробник №3', date: '2026-10-18', subject: 'math', exam_type: 'ege', group_id: 'g1', template_id: 't1', groups: { name: '11А' }, mock_exam_templates: { ...TEMPLATE } }
  // Половина группы уже внесена: Белов 1+0+2+1 = 4.
  stored = [
    { student_id: 's-bel', task_number: 1, points: 1 },
    { student_id: 's-bel', task_number: 2, points: 0 },
    { student_id: 's-bel', task_number: 3, points: 2 },
    { student_id: 's-bel', task_number: 4, points: 1 },
  ]
  totalsDb = new Map([['s-bel', 4]])
  rpcCalls = []
  rpcError = null
  notifyMockExamResult.mockReset()
})

async function ready() { await screen.findByLabelText('Белов Артём, задание 1') }

describe('MockExamGridPage — подхват и итоги', () => {
  it('подхватывает сохранённое, пустая клетка — пустая, а не ноль', async () => {
    open(); await ready()
    expect(rowValues('Белов Артём')).toEqual(['1', '0', '2', '1'])
    expect(rowValues('Сафин Амир')).toEqual(['', '', '', ''])
    const row = screen.getAllByTestId('mock-grid-row').find(r => r.textContent?.includes('Белов'))!
    expect(within(row).getByTestId('mock-grid-primary').textContent).toBe('4')
    // Нет таблицы перевода — тестовый равен первичному.
    expect(within(row).getByTestId('mock-grid-test').textContent).toBe('4')
    // У Сафина итога нет вовсе — не «0».
    const saf = screen.getAllByTestId('mock-grid-row').find(r => r.textContent?.includes('Сафин'))!
    expect(within(saf).getByTestId('mock-grid-primary').textContent).toBe('')
  })

  it('«набрано по номеру» считается только по заполненным клеткам', async () => {
    open(); await ready()
    const pct = screen.getAllByTestId('mock-grid-task-pct').map(td => td.textContent)
    // Решал только Белов: №1 1/1, №2 0/1, №3 2/2, №4 1/3.
    expect(pct).toEqual(['100%', '0%', '100%', '33%'])
  })

  it('Enter переводит в клетку ниже', async () => {
    open(); await ready()
    const c = cell('Белов Артём', 2)
    c.focus()
    fireEvent.keyDown(c, { key: 'Enter' })
    expect(document.activeElement).toBe(cell('Иванов Иван', 2))
  })
})

describe('MockExamGridPage — всё или ничего', () => {
  it('одна красная клетка — в базу не уходит НИЧЕГО, и сказано сколько и где', async () => {
    open(); await ready()
    fireEvent.change(cell('Иванов Кирилл', 1), { target: { value: '1' } })  // верная правка
    fireEvent.change(cell('Сафин Амир', 3), { target: { value: '5' } })     // №3 — максимум 2
    save()
    const status = await screen.findByTestId('mock-grid-status')
    expect(status.textContent).toMatch(/Не сохранено ничего: 1 клетка/)
    expect(status.textContent).toMatch(/Сафин Амир, №3/)
    expect(rpcCalls).toHaveLength(0)
    expect(notifyMockExamResult).not.toHaveBeenCalled()
    // Введённое не потеряно.
    expect(cell('Иванов Кирилл', 1).value).toBe('1')
  })

  it('исправили красную клетку — уходит вся таблица одним вызовом', async () => {
    open(); await ready()
    fireEvent.change(cell('Сафин Амир', 3), { target: { value: '5' } })
    save()
    await screen.findByTestId('mock-grid-status')
    fireEvent.change(cell('Сафин Амир', 3), { target: { value: '2' } })
    save()
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    expect(rpcCalls[0].p_mock_exam_id).toBe('e1')
    expect(rpcCalls[0].p_rows).toHaveLength(ROSTER.length)
    expect(rpcCalls[0].p_rows.find(r => r.student_id === 's-saf')!.points).toEqual([null, null, 2, null])
  })

  it('ошибка базы — показана на экране, введённое на месте', async () => {
    rpcError = { message: 'За задание №4 можно не больше 3' }
    open(); await ready()
    fireEvent.change(cell('Сафин Амир', 1), { target: { value: '1' } })
    save()
    expect((await screen.findByTestId('mock-grid-status')).textContent).toMatch(/Не сохранено: За задание №4/)
    expect(cell('Сафин Амир', 1).value).toBe('1')
    expect(notifyMockExamResult).not.toHaveBeenCalled()
  })
})

describe('MockExamGridPage — вставка из Excel', () => {
  const BLOCK = [
    'Сафин А.\t1\t1\t2\t3',
    'Иванов\t0\t0\t0\t0',
    'Петров Олег\t1\t1\t2\t3',
    'Иванов К\t1\t0\t1\t0',
  ].join('\n')

  it('с фамилиями: сопоставлено, «не найден» и «неоднозначно» — в отчёте, их баллы не легли никуда', async () => {
    open(); await ready()
    paste(nameCell('Белов Артём'), BLOCK)
    const report = await screen.findByTestId('mock-grid-report')
    expect(within(report).getByTestId('mock-report-ok').textContent).toMatch(/сопоставлено 2 из 4/)
    expect(within(report).getByTestId('mock-report-none').textContent).toMatch(/Петров Олег/)
    expect(within(report).getByTestId('mock-report-ambiguous').textContent).toMatch(/Иванов Иван, Иванов Кирилл/)
    expect(rowValues('Сафин Амир')).toEqual(['1', '1', '2', '3'])
    expect(rowValues('Иванов Кирилл')).toEqual(['1', '0', '1', '0'])
    // Строка «Иванов» (все нули) и строка Петрова не попали никому.
    expect(rowValues('Иванов Иван')).toEqual(['', '', '', ''])
    expect(rowValues('Белов Артём')).toEqual(['1', '0', '2', '1'])
  })

  it('«Отменить вставку» возвращает таблицу как была', async () => {
    open(); await ready()
    fireEvent.change(cell('Иванов Иван', 4), { target: { value: '2' } })
    paste(nameCell('Белов Артём'), BLOCK)
    await screen.findByTestId('mock-grid-report')
    expect(rowValues('Сафин Амир')).toEqual(['1', '1', '2', '3'])
    fireEvent.click(screen.getByTestId('mock-grid-undo'))
    expect(rowValues('Сафин Амир')).toEqual(['', '', '', ''])
    expect(rowValues('Иванов Кирилл')).toEqual(['', '', '', ''])
    // Ввод руками ДО вставки остался — отменяется только вставка.
    expect(rowValues('Иванов Иван')).toEqual(['', '', '', '2'])
    expect(screen.queryByTestId('mock-grid-report')).toBeNull()
  })

  it('без фамилий: от выбранной клетки вправо и вниз', async () => {
    open(); await ready()
    paste(cell('Иванов Кирилл', 3), '2\t3\n1\t0')
    expect(rowValues('Иванов Кирилл')).toEqual(['', '', '2', '3'])
    expect(rowValues('Сафин Амир')).toEqual(['', '', '1', '0'])
    expect((await screen.findByTestId('mock-grid-report')).textContent).toMatch(/4 клетки — по порядку/)
  })

  it('вставленный балл выше максимума — красная клетка, и сохранить нельзя', async () => {
    open(); await ready()
    paste(nameCell('Белов Артём'), 'Сафин\t1\t1\t2\t9')
    expect((await screen.findByTestId('mock-report-problems')).textContent).toMatch(/Сафин Амир, №4: 9 при максимуме 3/)
    save()
    expect((await screen.findByTestId('mock-grid-status')).textContent).toMatch(/Не сохранено ничего/)
    expect(rpcCalls).toHaveLength(0)
  })
})

describe('MockExamGridPage — уведомления', () => {
  it('только тем, у кого итог появился или изменился', async () => {
    open(); await ready()
    // Сафин — итог появился (0 → 3); Иванов Кирилл — тоже (1); Белов — не тронут.
    fireEvent.change(cell('Сафин Амир', 4), { target: { value: '3' } })
    fireEvent.change(cell('Иванов Кирилл', 1), { target: { value: '1' } })
    save()
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    await waitFor(() => expect(notifyMockExamResult).toHaveBeenCalledTimes(2))
    const who = notifyMockExamResult.mock.calls.map(c => c[0]).sort()
    expect(who).toEqual(['p-ivk', 'p-saf'])
    // Максимум в уведомлении — первичный шаблона (таблицы перевода нет): 1+1+2+3.
    expect(notifyMockExamResult).toHaveBeenCalledWith('p-saf', 'Пробник №3', 3, 7)
  })

  it('правка без изменения итога никого не будит', async () => {
    open(); await ready()
    // Белов: 1,0,2,1 → 0,1,2,1 — сумма та же, 4.
    fireEvent.change(cell('Белов Артём', 1), { target: { value: '0' } })
    fireEvent.change(cell('Белов Артём', 2), { target: { value: '1' } })
    save()
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    await screen.findByText(/Итоги ни у кого не изменились/)
    expect(notifyMockExamResult).not.toHaveBeenCalled()
  })

  it('второе сохранение подряд — тишина: сохранённое стало точкой отсчёта', async () => {
    open(); await ready()
    fireEvent.change(cell('Белов Артём', 4), { target: { value: '3' } })
    save()
    await waitFor(() => expect(notifyMockExamResult).toHaveBeenCalledTimes(1))
    // Кнопка гаснет: менять нечего. Меняем и возвращаем — итог тот же.
    fireEvent.change(cell('Белов Артём', 1), { target: { value: '0' } })
    fireEvent.change(cell('Белов Артём', 1), { target: { value: '1' } })
    expect((screen.getByTestId('mock-grid-save') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(cell('Белов Артём', 2), { target: { value: '1' } })
    fireEvent.change(cell('Белов Артём', 1), { target: { value: '0' } })
    await act(async () => { save() })
    await waitFor(() => expect(rpcCalls).toHaveLength(2))
    expect(notifyMockExamResult).toHaveBeenCalledTimes(1)
  })
})

describe('MockExamGridPage — пробник, которому таблица не положена', () => {
  it('без группы — говорит об этом, а не падает', async () => {
    exam = { ...exam!, group_id: null, groups: null }
    open()
    expect((await screen.findByTestId('mock-grid-notice')).textContent).toMatch(/нет группы — результаты не ввести/)
  })
  it('без шаблона — говорит об этом', async () => {
    exam = { ...exam!, template_id: null, mock_exam_templates: null }
    open()
    expect((await screen.findByTestId('mock-grid-notice')).textContent).toMatch(/нет шаблона/)
  })
})
