import { describe, expect, it } from 'vitest'
import { buildStudentTodo, formatDueIn, type TodoHomework } from '@/lib/studentTodo'

/**
 * Правила «что мне сдать». Проверяются здесь, без сети и без рендера, потому
 * что почти каждое из них — переиспользование чужого правила, и ошибка была бы
 * именно в стыке: закрытая тема, принятая работа, отправленная и ещё не
 * проверенная, счёт дней по календарю.
 */

const TODAY = '2026-08-06'

const openTopic = { is_open: null, available_from: '2026-01-01' }

function hw(overrides: Partial<TodoHomework> & { homeworkId: string }): TodoHomework {
  return {
    homeworkTitle: `ДЗ ${overrides.homeworkId}`,
    topicId: `t-${overrides.homeworkId}`,
    topicTitle: 'Тема',
    courseId: 'c1',
    courseTitle: 'Физика ЕГЭ',
    groupId: 'g1',
    dueAt: null,
    topic: openTopic,
    ...overrides,
  }
}

/** Сырая попытка в том же виде, в каком её отдаёт запрос очереди. */
function attempt(homeworkId: string, status: string, attemptNumber = 1, id = `a-${homeworkId}`) {
  return {
    id,
    student_id: 's1',
    status,
    attempt_number: attemptNumber,
    submitted_at: '2026-08-01T10:00:00Z',
    homework: {
      id: homeworkId,
      title: `ДЗ ${homeworkId}`,
      grade_scale: 'five',
      due_at: null,
      topic: { id: `t-${homeworkId}`, title: 'Тема', module: { id: 'm1', course: { id: 'c1', title: 'Физика ЕГЭ' } } },
    },
  }
}

const base = { rawAttempts: [], homework: [], tests: [], verdicts: [], today: TODAY }

describe('buildStudentTodo', () => {
  it('пустой вход — честное «всё сдано», а не пустой экран', () => {
    const todo = buildStudentTodo(base)
    expect(todo.isClear).toBe(true)
    expect(todo.overdue).toHaveLength(0)
  })

  it('просроченным считается ДЗ с прошедшим сроком без работы', () => {
    const todo = buildStudentTodo({ ...base, homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-04' })] })
    expect(todo.overdue.map(i => i.homeworkId)).toEqual(['h1'])
    expect(todo.overdue[0].days).toBe(-2)
    expect(todo.isClear).toBe(false)
  })

  it('принятая работа не попадает никуда — она закрыта', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-04' })],
      rawAttempts: [attempt('h1', 'accepted')],
    })
    expect(todo.overdue).toHaveLength(0)
    expect(todo.dueSoon).toHaveLength(0)
    expect(todo.isClear).toBe(true)
  })

  it('отправленная и ещё не проверенная работа не числится просроченной', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-04' })],
      rawAttempts: [attempt('h1', 'submitted')],
    })
    // Ученик своё сделал — краснеть ему не за что, ждём преподавателя.
    expect(todo.overdue).toHaveLength(0)
    expect(todo.isClear).toBe(true)
  })

  it('возврат на доработку идёт в свою корзину, а не в «сдать до»', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-10' })],
      rawAttempts: [attempt('h1', 'returned_for_revision')],
      verdicts: [{
        attemptId: 'a-h1', homeworkTitle: 'ДЗ h1', decision: 'returned_for_revision',
        score: null, gradeScale: 'five', comment: 'Переделай пункт 3', createdAt: '2026-08-05T10:00:00Z',
      }],
    })
    expect(todo.returned.map(i => i.homeworkId)).toEqual(['h1'])
    expect(todo.returned[0].comment).toBe('Переделай пункт 3')
    expect(todo.dueSoon).toHaveLength(0)
  })

  it('состояние работы берётся из ПОСЛЕДНЕЙ попытки, а не из первой', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-04' })],
      rawAttempts: [
        attempt('h1', 'returned_for_revision', 1, 'a1'),
        attempt('h1', 'accepted', 2, 'a2'),
      ],
    })
    // Цикл «вернули → пересдал → приняли» не должен оставлять работу в делах.
    expect(todo.returned).toHaveLength(0)
    expect(todo.overdue).toHaveLength(0)
  })

  it('ДЗ закрытой темы в дела не попадает — сдать туда всё равно нельзя', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-04', topic: { is_open: false, available_from: null } })],
    })
    expect(todo.overdue).toHaveLength(0)
    expect(todo.isClear).toBe(true)
  })

  it('ближайшие сроки — сверху', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'far', dueAt: '2026-08-20' }),
        hw({ homeworkId: 'near', dueAt: '2026-08-07' }),
      ],
    })
    expect(todo.dueSoon.map(i => i.homeworkId)).toEqual(['near', 'far'])
  })

  it('ДЗ без срока не выдумывает дедлайн', () => {
    const todo = buildStudentTodo({ ...base, homework: [hw({ homeworkId: 'h1' })] })
    expect(todo.dueSoon).toHaveLength(0)
    expect(todo.overdue).toHaveLength(0)
  })

  it('пройденные тестирования из списка уходят', () => {
    const todo = buildStudentTodo({
      ...base,
      tests: [
        { assignmentId: 'x1', testId: 't1', testTitle: 'Кинематика', topicId: 'tp1', topicTitle: 'Тема', completed: false },
        { assignmentId: 'x2', testId: 't2', testTitle: 'Динамика', topicId: 'tp2', topicTitle: 'Тема', completed: true },
      ],
    })
    expect(todo.tests.map(t => t.testId)).toEqual(['t1'])
  })

  it('«новое открылось» — только по дате открытия, ручной тумблер не считается', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'fresh', topicId: 'tp-fresh', topic: { is_open: null, available_from: '2026-08-03' } }),
        hw({ homeworkId: 'old',   topicId: 'tp-old',   topic: { is_open: null, available_from: '2026-05-01' } }),
        hw({ homeworkId: 'manual', topicId: 'tp-manual', topic: { is_open: true, available_from: null } }),
      ],
    })
    // Тумблер времени переключения не хранит — выдавать такую тему за новую
    // значило бы врать: её могли открыть месяц назад.
    expect(todo.newlyOpened.map(t => t.topicId)).toEqual(['tp-fresh'])
  })

  it('ДЗ без срока попадает в «без срока», а не пропадает с дашборда', () => {
    // Расхождение §123.4: «сдать до» требовало срока, поэтому работа без
    // дедлайна не попадала никуда — на странице ДЗ она при этом стояла в
    // «Нужно сделать». Ученик должен видеть всё, что надо сдать.
    const todo = buildStudentTodo({ ...base, homework: [hw({ homeworkId: 'h1' })] })
    expect(todo.noDue.map(i => i.homeworkId)).toEqual(['h1'])
    expect(todo.dueSoon).toHaveLength(0)
    expect(todo.overdue).toHaveLength(0)
    // И «всё сдано» больше не врёт поверх списка дел.
    expect(todo.isClear).toBe(false)
  })

  it('без срока не забирает работы у срочных корзин', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'late', dueAt: '2026-08-04' }),
        hw({ homeworkId: 'soon', dueAt: '2026-08-08' }),
        hw({ homeworkId: 'none' }),
      ],
    })
    expect(todo.overdue.map(i => i.homeworkId)).toEqual(['late'])
    expect(todo.dueSoon.map(i => i.homeworkId)).toEqual(['soon'])
    expect(todo.noDue.map(i => i.homeworkId)).toEqual(['none'])
  })

  it('без срока: сданное и принятое туда не попадает — правило состава общее', () => {
    // Отбор «чьё это дело» остаётся один на все корзины: отправленная работа —
    // не дело ученика, принятая закрыта, закрытая тема не считается.
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'sent' }),
        hw({ homeworkId: 'ok' }),
        hw({ homeworkId: 'closed', topic: { is_open: false, available_from: '2026-01-01' } }),
      ],
      rawAttempts: [attempt('sent', 'submitted'), attempt('ok', 'accepted')],
    })
    expect(todo.noDue).toHaveLength(0)
    expect(todo.isClear).toBe(true)
  })

  it('без срока: возврат на доработку остаётся в «вернули», а не уходит в «без срока»', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1' })],
      rawAttempts: [attempt('h1', 'returned_for_revision')],
    })
    expect(todo.returned.map(i => i.homeworkId)).toEqual(['h1'])
    expect(todo.noDue).toHaveLength(0)
  })

  it('без срока: порядок устойчивый — по курсу, затем по названию', () => {
    // Сортировать по дате нечем, а порядок ответа базы не гарантирован.
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'b', homeworkTitle: 'Ядро', courseTitle: 'Физика' }),
        hw({ homeworkId: 'a', homeworkTitle: 'Алгебра', courseTitle: 'Математика' }),
        hw({ homeworkId: 'c', homeworkTitle: 'Векторы', courseTitle: 'Физика' }),
      ],
    })
    expect(todo.noDue.map(i => i.homeworkId)).toEqual(['a', 'c', 'b'])
  })

  it('предмет курса доходит до строки — метку курса красит он, а не название', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-10', courseSubject: 'physics' })],
    })
    expect(todo.dueSoon[0].courseSubject).toBe('physics')
  })

  it('курс без предмета доходит как null, а не как строка «null»', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'h1', dueAt: '2026-08-10' })],
    })
    expect(todo.dueSoon[0].courseSubject).toBeNull()
  })

  it('«проверено» — последние пять вердиктов, от свежих', () => {
    const verdicts = Array.from({ length: 7 }, (_, i) => ({
      attemptId: `a${i}`, homeworkTitle: `ДЗ ${i}`, decision: 'accepted' as const,
      score: 5, gradeScale: 'five' as const, comment: null,
      createdAt: `2026-08-0${i + 1}T10:00:00Z`,
    }))
    const todo = buildStudentTodo({ ...base, verdicts })
    expect(todo.checked).toHaveLength(5)
    expect(todo.checked[0].homeworkTitle).toBe('ДЗ 6')
  })
})

describe('formatDueIn', () => {
  it('говорит по-человечески и склоняет', () => {
    expect(formatDueIn(0)).toBe('сегодня')
    expect(formatDueIn(1)).toBe('завтра')
    expect(formatDueIn(3)).toBe('через 3 дня')
    expect(formatDueIn(5)).toBe('через 5 дней')
    expect(formatDueIn(21)).toBe('через 21 день')
    expect(formatDueIn(-2)).toBe('просрочено на 2 дня')
    expect(formatDueIn(-11)).toBe('просрочено на 11 дней')
  })
})
