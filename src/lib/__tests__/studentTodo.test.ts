import { describe, expect, it } from 'vitest'
import {
  buildStudentTodo, formatDueIn, homeActions, homeworkIdsFor, parseHomeworkShow, splitDueWindow,
  type TodoHomework, type TodoVerdict,
} from '@/lib/studentTodo'

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

// ── §254. Кнопки-счётчики главной и отбор страницы ДЗ ─────────────────────────
describe('кнопки главной (§254)', () => {
  const verdict = (attemptId: string, createdAt: string, over: Partial<TodoVerdict> = {}): TodoVerdict => ({
    attemptId, homeworkTitle: 'Домашнее задание', decision: 'accepted', score: 4, gradeScale: 'five',
    comment: null, createdAt, homeworkId: `hw-${attemptId}`, topicTitle: `Тема ${attemptId}`, ...over,
  })

  it('счёт и подписи: просрочено (самое давнее), сдать за 2 недели (ближайшее), новые оценки (последняя)', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'o1', dueAt: '2026-06-27' }), // 40 дней назад
        hw({ homeworkId: 'o2', dueAt: '2026-08-01' }),
        hw({ homeworkId: 's1', dueAt: '2026-08-15' }), // через 9 дней
        hw({ homeworkId: 's2', dueAt: '2026-08-20' }), // через 14 — ещё в окне
        hw({ homeworkId: 'l1', dueAt: '2026-08-21' }), // через 15 — позже
      ],
      verdicts: [verdict('a1', '2026-08-03T12:00:00Z'), verdict('a2', '2026-08-05T12:00:00Z', { topicTitle: 'Производные', score: 4 })],
    })
    const actions = homeActions(todo)
    expect(actions.map(a => [a.show, a.count])).toEqual([['overdue', 2], ['soon', 2], ['checked', 2]])
    expect(actions[0].caption).toBe('самое давнее — 40 дней')
    expect(actions[1].caption).toBe('ближайшее — через 9 дней')
    expect(actions[2].caption).toBe('«Производные» — 4/5')
    expect(actions.map(a => a.href)).toEqual(['/my-homework?show=overdue', '/my-homework?show=soon', '/my-homework?show=checked'])
  })

  it('кнопка с нулём не рождается; всё по нулям — кнопок нет вовсе', () => {
    expect(homeActions(buildStudentTodo(base))).toEqual([])
    const onlyOverdue = buildStudentTodo({ ...base, homework: [hw({ homeworkId: 'o1', dueAt: '2026-08-05' })] })
    expect(homeActions(onlyOverdue).map(a => a.show)).toEqual(['overdue'])
    expect(homeActions(onlyOverdue)[0].caption).toBe('самое давнее — 1 день')
  })

  it('окно 14 дней пусто, а работы позже есть — «Сдать позже» с датой ближайшей', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'l1', dueAt: '2026-11-14' }), hw({ homeworkId: 'l2', dueAt: '2027-05-20' })],
    })
    expect(splitDueWindow(todo).soon).toHaveLength(0)
    const actions = homeActions(todo)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ show: 'later', count: 2, title: 'Сдать позже', caption: 'ближайшее — 14 ноября', href: '/my-homework?show=later' })
  })

  it('есть работы в окне — «Сдать позже» кнопкой не показывается', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 's1', dueAt: '2026-08-06' }), hw({ homeworkId: 'l1', dueAt: '2026-12-01' })],
    })
    expect(homeActions(todo).map(a => [a.show, a.count, a.caption])).toEqual([['soon', 1, 'ближайшее — сегодня']])
  })

  it('«Вернули на доработку» — своей кнопкой сразу после просрочки, важнее новых оценок', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [hw({ homeworkId: 'o1', dueAt: '2026-08-01' }), hw({ homeworkId: 'r1', topicTitle: 'Кинематика' }), hw({ homeworkId: 's1', dueAt: '2026-08-10' })],
      rawAttempts: [attempt('r1', 'returned_for_revision')],
      verdicts: [verdict('a9', '2026-08-05T12:00:00Z')],
    })
    const actions = homeActions(todo)
    expect(actions.map(a => a.show)).toEqual(['overdue', 'returned', 'soon', 'checked'])
    expect(actions[1].caption).toBe('«Кинематика»')
  })

  it('новые оценки — только принятые за 7 дней и по последнему вердикту работы', () => {
    const todo = buildStudentTodo({
      ...base,
      verdicts: [
        verdict('old', '2026-07-29T12:00:00Z'), // 8 дней назад — уже не новая
        verdict('ok', '2026-07-30T12:00:00Z'), // ровно 7 дней — ещё новая
        verdict('ret', '2026-08-04T12:00:00Z', { decision: 'returned_for_revision', score: null }),
        // по этой работе последний вердикт — возврат: принятие раньше не считается
        verdict('flip', '2026-08-01T12:00:00Z'),
        verdict('flip', '2026-08-02T12:00:00Z', { decision: 'returned_for_revision', score: null }),
      ],
    })
    expect(todo.newGrades.map(v => v.attemptId)).toEqual(['ok'])
    expect(homeworkIdsFor(todo, 'checked')).toEqual(['hw-ok'])
  })

  it('отбор страницы ДЗ — те же корзины, тем же порядком, что у кнопок', () => {
    const todo = buildStudentTodo({
      ...base,
      homework: [
        hw({ homeworkId: 'o2', dueAt: '2026-08-01' }), hw({ homeworkId: 'o1', dueAt: '2026-07-01' }),
        hw({ homeworkId: 's1', dueAt: '2026-08-12' }), hw({ homeworkId: 'l1', dueAt: '2026-09-30' }),
        hw({ homeworkId: 'n1' }),
      ],
    })
    expect(homeworkIdsFor(todo, 'overdue')).toEqual(['o1', 'o2'])
    expect(homeworkIdsFor(todo, 'soon')).toEqual(['s1'])
    expect(homeworkIdsFor(todo, 'later')).toEqual(['l1'])
    expect(homeworkIdsFor(todo, 'nodue')).toEqual(['n1'])
    for (const a of homeActions(todo)) expect(homeworkIdsFor(todo, a.show)).toHaveLength(a.count)
  })

  it('show из адреса: чужое значение — не отбор', () => {
    expect(parseHomeworkShow('overdue')).toBe('overdue')
    expect(parseHomeworkShow('later')).toBe('later')
    expect(parseHomeworkShow('всё')).toBeNull()
    expect(parseHomeworkShow(null)).toBeNull()
  })
})
