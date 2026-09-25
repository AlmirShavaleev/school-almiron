/**
 * §218. Экран «пробник по номерам заданий».
 *
 * Проверяется поведение, ради которого экран устроен так, как устроен:
 *   * красная клетка блокирует сохранение ЦЕЛИКОМ — в базу не уходит ничего;
 *   * «Отменить вставку» возвращает таблицу как была;
 *   * баллы строки, чью фамилию не узнали, не попадают никуда;
 *   * §219: сохранение никому ничего не шлёт; «Уведомить» шлёт одному;
 *     «Уведомить всех» — после подтверждения внутри страницы и не тому, кому
 *     этот итог уже отправлен; после изменения итога — снова можно.
 *
 * База подменена маленькой имитацией `save_mock_exam_grid` и
 * `notify_mock_exam_results`: итоги и отметки «что отправлено» живут между
 * вызовами. Правило «тот же итог второй раз не уходит» в имитации — копия
 * правила SQL-функции (PENDING_219.sql, пробы — PROJECT_STATE §219); здесь
 * проверяется, что экран показывает и отправляет ровно по нему.
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
interface ResultRow {
  student_id: string; score: number; part1_score: number; part2_score: number
  notified_at: string | null; notified_score: number | null; notified_part1_score: number | null; notified_part2_score: number | null
}
/** Итоги «в базе» — mock_exam_results с отметкой об отправке (§219). */
let resultsDb: Map<string, ResultRow>
let rpcCalls: { p_mock_exam_id: string; p_rows: { student_id: string; points: (number | null)[] }[] }[]
let rpcError: { message: string } | null
/** Вызовы notify_mock_exam_results и кому по ним «ушло». */
let notifyCalls: { p_student_ids: string[] | null; sentTo: string[] }[]

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
      if (table === 'mock_exam_results') return thenable({ data: [...resultsDb.values()].map(r => ({ ...r })), error: null })
      if (table === 'notifications' || table === 'notification_queue') throw new Error(`экран не пишет в ${table} сам — только через notify_mock_exam_results`)
      throw new Error(`неожиданная таблица ${table}`)
    },
    rpc: (fn: string, args: { p_mock_exam_id: string; p_rows?: unknown; p_student_ids?: string[] | null }) => {
      if (fn === 'notify_mock_exam_results') return fakeNotify({ p_mock_exam_id: args.p_mock_exam_id, p_student_ids: args.p_student_ids ?? null })
      if (fn !== 'save_mock_exam_grid') throw new Error(fn)
      rpcCalls.push(JSON.parse(JSON.stringify(args)))
      if (rpcError) return Promise.resolve({ data: null, error: rpcError })
      const rows = (args.p_rows as { student_id: string; points: (number | null)[] }[]).map(r => {
        const filled = r.points.filter((p): p is number => p != null)
        const score = filled.length ? filled.reduce((a, b) => a + b, 0) : null
        const prev = resultsDb.get(r.student_id)
        if (score == null) resultsDb.delete(r.student_id)
        else {
          // Шаблон теста: №1–2 — первая часть.
          const p1 = (r.points[0] ?? 0) + (r.points[1] ?? 0)
          resultsDb.set(r.student_id, {
            notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null,
            ...prev, student_id: r.student_id, score, part1_score: p1, part2_score: score - p1,
          })
        }
        return { student_id: r.student_id, old_score: prev?.score ?? null, score }
      })
      return Promise.resolve({ data: { rows }, error: null })
    },
  },
}))

/** Имитация notify_mock_exam_results: копия правила SQL-функции. */
function fakeNotify(args: { p_mock_exam_id: string; p_student_ids: string[] | null }) {
  const at = '2026-09-25T17:40:00Z'
  const sentTo: string[] = []
  let already = 0, noResult = 0
  const ids = args.p_student_ids ?? ROSTER.map(r => r.id)
  for (const id of ids) {
    const r = resultsDb.get(id)
    if (!r) { if (args.p_student_ids) noResult++; continue }
    if (r.notified_at && r.notified_score === r.score && r.notified_part1_score === r.part1_score && r.notified_part2_score === r.part2_score) { already++; continue }
    resultsDb.set(id, { ...r, notified_at: at, notified_score: r.score, notified_part1_score: r.part1_score, notified_part2_score: r.part2_score })
    sentTo.push(id)
  }
  notifyCalls.push({ p_student_ids: args.p_student_ids, sentTo })
  return Promise.resolve({
    data: { sent: sentTo.length, telegram: sentTo.filter(id => id === 's-bel').length, already, no_result: noResult, no_profile: 0, rows: sentTo.map(student_id => ({ student_id, notified_at: at })) },
    error: null,
  })
}

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
  resultsDb = new Map([['s-bel', { student_id: 's-bel', score: 4, part1_score: 1, part2_score: 3, notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null }]])
  rpcCalls = []
  rpcError = null
  notifyCalls = []
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
    expect(notifyCalls).toHaveLength(0)
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
    expect(notifyCalls).toHaveLength(0)
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

const rowOf = (name: string) => screen.getAllByTestId('mock-grid-row').find(r => r.textContent?.includes(name))!
const notifyBtn = (name: string) => within(rowOf(name)).queryByTestId('mock-grid-notify') as HTMLButtonElement | null

describe('MockExamGridPage — уведомления кнопкой (§219)', () => {
  it('сохранение — черновик: никому ничего, и это сказано', async () => {
    open(); await ready()
    fireEvent.change(cell('Сафин Амир', 4), { target: { value: '3' } })
    fireEvent.change(cell('Иванов Кирилл', 1), { target: { value: '1' } })
    save()
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    expect((await screen.findByTestId('mock-grid-status')).textContent).toMatch(/Ученики ничего не получили — это черновик/)
    expect(notifyCalls).toHaveLength(0)
    // Второе сохранение — тоже тишина.
    fireEvent.change(cell('Сафин Амир', 3), { target: { value: '2' } })
    await act(async () => { save() })
    await waitFor(() => expect(rpcCalls).toHaveLength(2))
    expect(notifyCalls).toHaveLength(0)
  })

  it('у ученика без сохранённого итога «Уведомить» недоступна', async () => {
    open(); await ready()
    const btn = notifyBtn('Сафин Амир')!
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/Нет сохранённого итога/)
    // Ввёл, но не сохранил — всё ещё недоступна: итога в базе нет.
    fireEvent.change(cell('Сафин Амир', 1), { target: { value: '1' } })
    expect(notifyBtn('Сафин Амир')!.disabled).toBe(true)
  })

  it('«Уведомить» в строке шлёт одному — и строка показывает «отправлено»', async () => {
    open(); await ready()
    const btn = notifyBtn('Белов Артём')!
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(notifyCalls).toHaveLength(1))
    expect(notifyCalls[0].p_student_ids).toEqual(['s-bel'])
    expect(notifyCalls[0].sentTo).toEqual(['s-bel'])
    expect((await within(rowOf('Белов Артём')).findByTestId('mock-grid-notified')).textContent).toMatch(/отправлено 25\.09, 20:40/)
    // Кнопки больше нет: тот же итог второй раз не шлём.
    expect(notifyBtn('Белов Артём')).toBeNull()
    expect(screen.getByTestId('mock-grid-status').textContent).toMatch(/Белов Артём: результат отправлен\. В Telegram — тоже/)
  })

  it('несохранённая правка в строке — кнопка ждёт сохранения: ушёл бы старый итог', async () => {
    open(); await ready()
    fireEvent.change(cell('Белов Артём', 4), { target: { value: '3' } })
    expect(notifyBtn('Белов Артём')!.disabled).toBe(true)
    expect(notifyBtn('Белов Артём')!.title).toMatch(/сначала «Сохранить»/)
    expect((screen.getByTestId('mock-grid-notify-all') as HTMLButtonElement).disabled).toBe(true)
  })

  it('«Уведомить всех»: подтверждение на странице, повтор не шлёт тем же, после изменения итога — снова', async () => {
    // Дано: итоги у Белова (4) и Сафина (уже внесён и сохранён).
    open(); await ready()
    fireEvent.change(cell('Сафин Амир', 4), { target: { value: '3' } })
    save()
    await screen.findByText(/это черновик/)

    // Подтверждение — внутри страницы, не window.confirm.
    const confirmSpy = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByTestId('mock-grid-notify-all'))
    const dlg = await screen.findByTestId('mock-grid-notify-confirm')
    expect(dlg.textContent).toMatch(/Отправить 2 ученикам\?/)
    expect(confirmSpy).not.toHaveBeenCalled()
    fireEvent.click(within(dlg).getByTestId('mock-grid-notify-send'))
    await waitFor(() => expect(notifyCalls).toHaveLength(1))
    expect(notifyCalls[0].p_student_ids).toBeNull()
    expect(notifyCalls[0].sentTo.sort()).toEqual(['s-bel', 's-saf'])
    await waitFor(() => expect(screen.queryByTestId('mock-grid-notify-confirm')).toBeNull())
    expect(screen.getByTestId('mock-grid-status').textContent).toMatch(/Отправлено 2 ученикам/)

    // Всем, у кого итог есть, он уже отправлен — «Уведомить всех» гаснет.
    await waitFor(() => expect((screen.getByTestId('mock-grid-notify-all') as HTMLButtonElement).disabled).toBe(true))

    // Итог Сафина поменялся — в строке пометка и снова кнопка; «всех» — только ему.
    fireEvent.change(cell('Сафин Амир', 3), { target: { value: '1' } })
    await act(async () => { save() })
    await waitFor(() => expect(rpcCalls).toHaveLength(2))
    expect(await within(rowOf('Сафин Амир')).findByTestId('mock-grid-notify-changed')).toBeTruthy()
    expect(notifyBtn('Сафин Амир')!.disabled).toBe(false)
    expect(within(rowOf('Белов Артём')).getByTestId('mock-grid-notified')).toBeTruthy()

    fireEvent.click(screen.getByTestId('mock-grid-notify-all'))
    const dlg2 = await screen.findByTestId('mock-grid-notify-confirm')
    expect(dlg2.textContent).toMatch(/Отправить 1 ученику\?/)
    expect(dlg2.textContent).toMatch(/уже отправлен \(1\), повторно не уйдёт/)
    fireEvent.click(within(dlg2).getByTestId('mock-grid-notify-send'))
    await waitFor(() => expect(notifyCalls).toHaveLength(2))
    expect(notifyCalls[1].sentTo).toEqual(['s-saf'])
    confirmSpy.mockRestore()
  })

  it('«Отмена» в подтверждении — ничего не уходит', async () => {
    open(); await ready()
    fireEvent.click(screen.getByTestId('mock-grid-notify-all'))
    fireEvent.click(await screen.findByTestId('mock-grid-notify-cancel'))
    expect(screen.queryByTestId('mock-grid-notify-confirm')).toBeNull()
    expect(notifyCalls).toHaveLength(0)
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
