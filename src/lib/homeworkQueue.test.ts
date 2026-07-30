import { describe, expect, it } from 'vitest'
import { groupByCourse, isAlreadyReviewedError, isSubmittedLate, sortQueue, toQueueRows } from './homeworkQueue'

function rawRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    homework_id: 'hw1',
    student_id: 's1',
    attempt_number: 1,
    status: 'submitted',
    submitted_at: '2026-07-20T10:00:00Z',
    created_at: '2026-07-20T09:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
    homework: {
      id: 'hw1',
      title: 'ДЗ по кинематике',
      grade_scale: null,
      topic: { id: 't1', title: 'Кинематика', module: { id: 'm1', course: { id: 'c1', title: 'Физика ОГЭ' } } },
    },
    ...over,
  }
}

describe('toQueueRows', () => {
  it('разворачивает вложенный join в плоскую строку', () => {
    const rows = toQueueRows([rawRow()])
    expect(rows).toHaveLength(1)
    expect(rows[0].attempt.id).toBe('a1')
    expect(rows[0].homeworkTitle).toBe('ДЗ по кинематике')
    expect(rows[0].gradeScale).toBe(null)
    expect(rows[0].topicTitle).toBe('Кинематика')
    expect(rows[0].courseTitle).toBe('Физика ОГЭ')
    // homework не должен протечь в attempt
    expect((rows[0].attempt as any).homework).toBeUndefined()
  })

  it('отбрасывает строки с оборванным join, не роняя остальные', () => {
    const broken = rawRow({ id: 'a2', homework: { id: 'hw2', title: 'x', topic: null } })
    const rows = toQueueRows([rawRow(), broken])
    expect(rows).toHaveLength(1)
    expect(rows[0].attempt.id).toBe('a1')
  })
})

describe('sortQueue', () => {
  it('старые сдачи выше новых', () => {
    const rows = toQueueRows([
      rawRow({ id: 'new', submitted_at: '2026-07-25T10:00:00Z' }),
      rawRow({ id: 'old', submitted_at: '2026-07-19T10:00:00Z' }),
    ])
    expect(sortQueue(rows).map(r => r.attempt.id)).toEqual(['old', 'new'])
  })
})

describe('groupByCourse', () => {
  it('группирует по курсу, сохраняя порядок очереди', () => {
    const other = rawRow({
      id: 'a3',
      homework: {
        id: 'hw3',
        title: 'ДЗ',
        grade_scale: null,
        topic: { id: 't2', title: 'Проценты', module: { id: 'm2', course: { id: 'c2', title: 'Математика ОГЭ' } } },
      },
    })
    const groups = groupByCourse(toQueueRows([rawRow(), other, rawRow({ id: 'a4' })]))
    expect(groups).toHaveLength(2)
    expect(groups[0].courseTitle).toBe('Физика ОГЭ')
    expect(groups[0].rows.map(r => r.attempt.id)).toEqual(['a1', 'a4'])
    expect(groups[1].rows.map(r => r.attempt.id)).toEqual(['a3'])
  })
})

describe('isSubmittedLate', () => {
  function row(dueAt: string | null, submittedAt: string | null) {
    return toQueueRows([
      rawRow({
        submitted_at: submittedAt,
        homework: {
          id: 'hw1', title: 'ДЗ', grade_scale: 'five', due_at: dueAt,
          topic: { id: 't1', title: 'Тема', module: { id: 'm1', course: { id: 'c1', title: 'Курс' } } },
        },
      }),
    ])[0]
  }

  it('сдано позже срока — просрочено', () => {
    expect(isSubmittedLate(row('2026-07-20T00:00:00Z', '2026-07-21T10:00:00Z'))).toBe(true)
  })

  it('сдано до срока — не просрочено', () => {
    expect(isSubmittedLate(row('2026-07-25T00:00:00Z', '2026-07-21T10:00:00Z'))).toBe(false)
  })

  it('срока нет — просрочки быть не может', () => {
    expect(isSubmittedLate(row(null, '2026-07-21T10:00:00Z'))).toBe(false)
  })

  it('даты сдачи нет — не угадываем, считаем «не просрочено»', () => {
    expect(isSubmittedLate(row('2026-07-20T00:00:00Z', null))).toBe(false)
  })

  it('сравнивается момент СДАЧИ с дедлайном, а не «сейчас»: работа, сданная вовремя, не станет просроченной со временем', () => {
    // Дедлайн давно прошёл, но сдали до него — значит ученик не опоздал.
    const long_ago = row('2020-01-10T00:00:00Z', '2020-01-05T00:00:00Z')
    expect(isSubmittedLate(long_ago)).toBe(false)
  })

  it('due_at пробрасывается в строку очереди', () => {
    expect(row('2026-07-20T00:00:00Z', '2026-07-21T10:00:00Z').dueAt).toBe('2026-07-20T00:00:00Z')
  })
})

describe('isAlreadyReviewedError — работу успел проверить кто-то другой', () => {
  it('узнаёт отказ RPC при повторном вердикте', () => {
    // topic_homework_review_attempt меняет статус только where status='submitted'
    // и иначе падает этим текстом — своего кода ошибки у него нет.
    expect(isAlreadyReviewedError({ message: 'Попытка не в статусе «сдано»' })).toBe(true)
  })

  it('не путает с другими ошибками того же RPC', () => {
    expect(isAlreadyReviewedError({ message: 'Балл должен быть от 0 до 5' })).toBe(false)
    expect(isAlreadyReviewedError({ message: 'У этого ДЗ есть шкала баллов — укажите балл (0–5)' })).toBe(false)
    expect(isAlreadyReviewedError({ message: 'Нет прав' })).toBe(false)
  })

  it('не падает на пустом и не-объекте', () => {
    expect(isAlreadyReviewedError(null)).toBe(false)
    expect(isAlreadyReviewedError(undefined)).toBe(false)
    expect(isAlreadyReviewedError('Попытка не в статусе «сдано»')).toBe(true)
  })
})
