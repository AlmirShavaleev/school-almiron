/**
 * §213. Вход для модели, переписывающей комментарий (board/064).
 *
 * Главная проверка здесь одна, и она про ответы ученика. Они прочитаны ИИ с
 * почерка и могут быть прочитаны неверно, а комментарий уезжает ученику:
 * приписать человеку ответ, которого он не писал, — спор на ровном месте.
 * Поэтому тест не «поле не копируется», а «этой строки нет в собранном входе
 * НИ ПРИ КАКИХ данных».
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_GENERAL_NOTES,
  MAX_NOTES_PER_TASK,
  MAX_TASKS,
  SYSTEM_PROMPT,
  buildModelInput,
  refuseReason,
  taskKey,
  userMessage,
} from '../../../supabase/functions/rewrite-homework-comment/prompt.ts'

/** Строка таблицы ровно в том виде, в каком она лежит в базе (§199). */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    attempt_id: 'a1',
    no: '3',
    verdict: 'wrong',
    student_answer: 'ОТВЕТ-УЧЕНИКА-144',
    expected_answer: '160 рублей',
    note: 'ЗАМЕТКА-ИИ: написано 144 вместо 160',
    position: 10,
    updated_by: null,
    updated_at: '2026-09-21T09:00:00Z',
    ...over,
  }
}

const SOURCE = {
  homeworkTitle: 'Домашняя работа №3',
  topicTitle: 'Законы Ньютона',
  gradeScale: 'five',
}

describe('§213 — ответы ученика до модели не доходят', () => {
  it('в собранном входе нет ни ответа ученика, ни заметки ИИ из строки', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [row()], notes: [] })
    const serialized = userMessage(input)

    expect(serialized).not.toContain('ОТВЕТ-УЧЕНИКА-144')
    expect(serialized).not.toContain('ЗАМЕТКА-ИИ')
    expect(serialized).not.toContain('student_answer')
    // Эталон при этом на месте: правильный ответ — не ответ ученика.
    expect(serialized).toContain('160 рублей')
  })

  it('поля, которых нет в белом списке, не проходят — даже незнакомые', () => {
    // Завтра в таблице появится новый столбец. Он не должен уехать в модель
    // просто потому, что про него забыли.
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ handwriting_raw: 'СЫРОЙ-ПОЧЕРК', ocr_confidence: 0.4, student_answer_2: 'ЕЩЁ-ОТВЕТ' })],
      notes: [],
    })
    const serialized = userMessage(input)

    expect(serialized).not.toContain('СЫРОЙ-ПОЧЕРК')
    expect(serialized).not.toContain('ЕЩЁ-ОТВЕТ')
    expect(serialized).not.toContain('ocr_confidence')
    expect(Object.keys(input.tasks[0]).sort()).toEqual(['expected', 'no', 'verdict'])
  })

  it('правило держится на любом наборе строк, а не на одной', () => {
    const tasks = Array.from({ length: 30 }, (_v, i) => row({
      no: String(i + 1),
      verdict: ['correct', 'wrong', 'partial', 'unchecked'][i % 4],
      student_answer: `СЕКРЕТ-${i}`,
      expected_answer: i % 3 === 0 ? null : `эталон-${i}`,
      note: `ЗАМЕТКА-${i}`,
    }))
    const serialized = userMessage(buildModelInput({ ...SOURCE, tasks, notes: [] }))

    for (let i = 0; i < 30; i += 1) {
      expect(serialized).not.toContain(`СЕКРЕТ-${i}`)
      expect(serialized).not.toContain(`ЗАМЕТКА-${i}`)
    }
  })

  it('и промпт прямо запрещает модели выдумывать ответ ученика', () => {
    expect(SYSTEM_PROMPT).toContain('НЕ пиши, какой ответ дал ученик')
    expect(SYSTEM_PROMPT).toContain('НЕ называй оценку и балл')
  })
})

describe('§213 — что уезжает в модель', () => {
  it('номер, статус и эталон каждой строки', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '5', verdict: 'correct', expected_answer: '12 м/с' })],
      notes: [],
    })
    expect(input.tasks).toEqual([{ no: '5', verdict: 'correct', expected: '12 м/с' }])
    expect(input.homework).toBe('Домашняя работа №3')
    expect(input.topic).toBe('Законы Ньютона')
    expect(input.grade_scale).toBe('five')
  })

  it('неизвестный вердикт читается как «не сверено», а не ломает вход', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [row({ verdict: 'маловероятно' })], notes: [] })
    expect(input.tasks[0].verdict).toBe('unchecked')
  })

  it('сводка считается по тем строкам, что уехали', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [
        row({ no: '1', verdict: 'correct' }),
        row({ no: '2', verdict: 'correct' }),
        row({ no: '3', verdict: 'wrong' }),
        row({ no: '4', verdict: 'partial' }),
        row({ no: '5', verdict: 'unchecked' }),
      ],
      notes: [],
    })
    expect(input.summary).toEqual({ correct: 2, wrong: 1, partial: 1, unchecked: 1, total: 5 })
  })

  it('замечания-рамки ложатся под свои задания', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '3' }), row({ no: '7', verdict: 'correct' })],
      notes: [
        { task: '№ 3', text: 'Потерян процент во втором шаге' },
        { task: '7.', text: 'В отборе корней потерян второй случай' },
      ],
    })
    // «№ 3», «3.» и «3» — одно задание.
    expect(input.tasks[0].notes).toEqual(['Потерян процент во втором шаге'])
    expect(input.tasks[1].notes).toEqual(['В отборе корней потерян второй случай'])
    expect(input.general_notes).toEqual([])
  })

  it('замечание без задания и замечание к удалённой строке — в общий список', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '3' })],
      notes: [
        { task: null, text: 'Оформление в целом аккуратное' },
        { task: '99', text: 'Строку этого задания преподаватель удалил' },
      ],
    })
    expect(input.general_notes).toEqual([
      'Оформление в целом аккуратное',
      'Строку этого задания преподаватель удалил',
    ])
  })

  it('пустые замечания и мусор отбрасываются молча', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '3' })],
      notes: [{ task: '3', text: '   ' }, { task: '3', text: 42 }, null, 'строка'],
    })
    expect(input.tasks[0].notes).toBeUndefined()
    expect(input.general_notes).toEqual([])
  })

  it('вход ограничен сверху — он должен оставаться дешёвым', () => {
    const tasks = Array.from({ length: MAX_TASKS + 20 }, (_v, i) => row({ no: String(i + 1) }))
    const notes = [
      ...Array.from({ length: MAX_NOTES_PER_TASK + 5 }, (_v, i) => ({ task: '1', text: `по заданию ${i}` })),
      ...Array.from({ length: MAX_GENERAL_NOTES + 5 }, (_v, i) => ({ task: null, text: `общее ${i}` })),
    ]
    const input = buildModelInput({ ...SOURCE, tasks, notes })

    expect(input.tasks).toHaveLength(MAX_TASKS)
    expect(input.tasks[0].notes).toHaveLength(MAX_NOTES_PER_TASK)
    expect(input.general_notes).toHaveLength(MAX_GENERAL_NOTES)
  })

  it('строка без номера в модель не едет: назвать её в комментарии нечем', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [row({ no: '  ' }), row({ no: '4' })], notes: [] })
    expect(input.tasks.map(t => t.no)).toEqual(['4'])
  })
})

describe('§213 — отказ до обращения к модели', () => {
  it('пустая таблица — переписывать не из чего', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [], notes: [] })
    expect(refuseReason(input)).toContain('пуста')
  })

  it('таблица из одних безымянных строк — тот же отказ', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [row({ no: '' })], notes: [] })
    expect(refuseReason(input)).not.toBeNull()
  })

  it('есть хоть одна строка — отказа нет', () => {
    const input = buildModelInput({ ...SOURCE, tasks: [row()], notes: [] })
    expect(refuseReason(input)).toBeNull()
  })
})

describe('§213 — мелочи, на которых ломаются входы', () => {
  it('ничего не передали — пустой вход, а не исключение', () => {
    const input = buildModelInput({})
    expect(input.tasks).toEqual([])
    expect(input.homework).toBeNull()
    expect(input.grade_scale).toBeNull()
    expect(refuseReason(input)).not.toBeNull()
  })

  it('номер задания сравнивается без № и точек', () => {
    expect(taskKey('№ 4')).toBe('4')
    expect(taskKey('4.')).toBe('4')
    expect(taskKey(' 4 ')).toBe('4')
    expect(taskKey(null)).toBe('')
  })

  it('неизвестная шкала не выдаётся за пятибалльную', () => {
    expect(buildModelInput({ gradeScale: 'twelve', tasks: [row()] }).grade_scale).toBeNull()
  })
})

describe('§213 — повторы', () => {
  it('дословный дубль замечания уезжает один раз', () => {
    // §207: прежние переносы находок ИИ накопили точные дубли рамок, и они
    // лежат на работах до сих пор. Платить за них токенами незачем.
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '3' })],
      notes: [
        { task: '3', text: 'Знак ускорения при торможении отрицательный' },
        { task: '3', text: 'Знак ускорения при торможении отрицательный' },
        { task: null, text: 'Оформление аккуратное' },
        { task: null, text: 'Оформление аккуратное' },
      ],
    })
    expect(input.tasks[0].notes).toEqual(['Знак ускорения при торможении отрицательный'])
    expect(input.general_notes).toEqual(['Оформление аккуратное'])
  })

  it('одинаковый текст у РАЗНЫХ заданий — не дубль', () => {
    const input = buildModelInput({
      ...SOURCE,
      tasks: [row({ no: '3' }), row({ no: '5' })],
      notes: [
        { task: '3', text: 'Нет единиц измерения' },
        { task: '5', text: 'Нет единиц измерения' },
      ],
    })
    expect(input.tasks[0].notes).toEqual(['Нет единиц измерения'])
    expect(input.tasks[1].notes).toEqual(['Нет единиц измерения'])
  })
})
