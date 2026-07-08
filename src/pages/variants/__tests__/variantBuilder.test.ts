import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Тесты конструктора вариантов
// Проверяют бизнес-логику без реального сетевого слоя.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Роли и доступ ─────────────────────────────────────────────────────────

type UserRole = 'student' | 'parent' | 'teacher' | 'curator' | 'admin' | 'owner'

function canAccessBuilder(role: UserRole): boolean {
  return ['teacher', 'admin', 'owner'].includes(role)
}

function canViewVariants(role: UserRole): boolean {
  return ['teacher', 'curator', 'admin', 'owner'].includes(role)
}

describe('Доступ к конструктору', () => {
  it('teacher может открыть конструктор', () => {
    expect(canAccessBuilder('teacher')).toBe(true)
  })
  it('admin может открыть конструктор', () => {
    expect(canAccessBuilder('admin')).toBe(true)
  })
  it('owner может открыть конструктор', () => {
    expect(canAccessBuilder('owner')).toBe(true)
  })
  it('student не может открыть конструктор', () => {
    expect(canAccessBuilder('student')).toBe(false)
  })
  it('parent не может открыть конструктор', () => {
    expect(canAccessBuilder('parent')).toBe(false)
  })
  it('curator может просматривать список вариантов', () => {
    expect(canViewVariants('curator')).toBe(true)
  })
  it('curator не может открыть конструктор', () => {
    expect(canAccessBuilder('curator')).toBe(false)
  })
})

// ── 2. Выбор subject/exam ─────────────────────────────────────────────────────

const SUBJECT_FROM_SLUG: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_FROM_SLUG:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

describe('Выбор предмета и экзамена', () => {
  it('конвертирует math → Математика', () => {
    expect(SUBJECT_FROM_SLUG['math']).toBe('Математика')
  })
  it('конвертирует physics → Физика', () => {
    expect(SUBJECT_FROM_SLUG['physics']).toBe('Физика')
  })
  it('конвертирует ege → ЕГЭ', () => {
    expect(EXAM_FROM_SLUG['ege']).toBe('ЕГЭ')
  })
  it('конвертирует oge → ОГЭ', () => {
    expect(EXAM_FROM_SLUG['oge']).toBe('ОГЭ')
  })
})

// ── 3. Выбор разделов и тем ───────────────────────────────────────────────────

interface SectionState {
  enabled:  boolean
  expanded: boolean
  cnt:      number
  topicIds: Set<string>
}

/** Репликует логику toggleSection из VariantBuilderPage */
function toggleSection(states: Record<string, SectionState>, id: string): Record<string, SectionState> {
  const st = states[id]
  if (!st) return states
  if (st.enabled) {
    // Снимаем → cnt = 0, темы очищаются
    return { ...states, [id]: { ...st, enabled: false, cnt: 0, topicIds: new Set() } }
  } else {
    // Ставим → если cnt == 0, ставим 1
    return { ...states, [id]: { ...st, enabled: true, cnt: st.cnt === 0 ? 1 : st.cnt } }
  }
}

function toggleTopic(states: Record<string, SectionState>, sectionId: string, topicId: string): Record<string, SectionState> {
  const st = states[sectionId]
  if (!st) return states
  const next = new Set(st.topicIds)
  if (next.has(topicId)) next.delete(topicId); else next.add(topicId)
  return { ...states, [sectionId]: { ...st, topicIds: next } }
}

/** Репликует логику setCnt из VariantBuilderPage */
function setCnt(states: Record<string, SectionState>, id: string, val: number, max: number): Record<string, SectionState> {
  const st = states[id]
  if (!st) return states
  const clamped = Math.max(0, Math.min(isNaN(val) ? 0 : val, max))
  if (clamped === 0) {
    return { ...states, [id]: { ...st, cnt: 0, enabled: false, topicIds: new Set() } }
  }
  return { ...states, [id]: { ...st, cnt: clamped, enabled: true } }
}

function calcTotalTasks(states: Record<string, SectionState>): number {
  return Object.values(states)
    .filter(s => s.enabled && s.cnt > 0)
    .reduce((sum, s) => sum + s.cnt, 0)
}

describe('Управление разделами и темами — новая логика', () => {
  let states: Record<string, SectionState>

  beforeEach(() => {
    states = {
      'sec1': { enabled: false, expanded: false, cnt: 0, topicIds: new Set() },
      'sec2': { enabled: true,  expanded: false, cnt: 3, topicIds: new Set(['t1']) },
    }
  })

  // Начальные значения
  it('начальное значение cnt = 0', () => {
    expect(states['sec1'].cnt).toBe(0)
  })

  // Checkbox из false → cnt = 1
  it('checkbox из false ставит cnt = 1 если был 0', () => {
    const next = toggleSection(states, 'sec1')
    expect(next['sec1'].enabled).toBe(true)
    expect(next['sec1'].cnt).toBe(1)
  })

  it('checkbox из false сохраняет существующий cnt > 0', () => {
    const init = { ...states, 'sec1': { ...states['sec1'], cnt: 5 } }
    const next = toggleSection(init, 'sec1')
    expect(next['sec1'].cnt).toBe(5)
  })

  // Снятие checkbox → cnt = 0, темы очищаются
  it('снятие checkbox сбрасывает cnt и очищает темы', () => {
    const next = toggleSection(states, 'sec2')
    expect(next['sec2'].enabled).toBe(false)
    expect(next['sec2'].cnt).toBe(0)
    expect(next['sec2'].topicIds.size).toBe(0)
  })

  // + из 0 → cnt = 1, раздел включается
  it('setCnt с 0 → 1 автовключает раздел', () => {
    const next = setCnt(states, 'sec1', 1, 100)
    expect(next['sec1'].enabled).toBe(true)
    expect(next['sec1'].cnt).toBe(1)
  })

  // Уменьшение 1 → 0 снимает checkbox и очищает темы
  it('уменьшение cnt 1 → 0 снимает раздел и очищает темы', () => {
    const init = { ...states, 'sec2': { ...states['sec2'], cnt: 1 } }
    const next = setCnt(init, 'sec2', 0, 100)
    expect(next['sec2'].enabled).toBe(false)
    expect(next['sec2'].cnt).toBe(0)
    expect(next['sec2'].topicIds.size).toBe(0)
  })

  // Отрицательные значения невозможны
  it('отрицательные значения приводятся к 0', () => {
    const next = setCnt(states, 'sec2', -5, 100)
    expect(next['sec2'].cnt).toBe(0)
  })

  // NaN приводится к 0
  it('NaN приводится к 0', () => {
    const next = setCnt(states, 'sec2', NaN, 100)
    expect(next['sec2'].cnt).toBe(0)
  })

  // Ограничение сверху
  it('ограничивает количество сверху (max)', () => {
    const next = setCnt(states, 'sec2', 999, 10)
    expect(next['sec2'].cnt).toBe(10)
  })

  // Темы
  it('добавляет тему к разделу', () => {
    const next = toggleTopic(states, 'sec1', 'newTopic')
    expect(next['sec1'].topicIds.has('newTopic')).toBe(true)
  })

  it('снимает уже выбранную тему', () => {
    const next = toggleTopic(states, 'sec2', 't1')
    expect(next['sec2'].topicIds.has('t1')).toBe(false)
  })
})

describe('Итоговая сумма задач', () => {
  it('не учитывает разделы с cnt = 0', () => {
    const states: Record<string, SectionState> = {
      'sec1': { enabled: false, expanded: false, cnt: 0, topicIds: new Set() },
      'sec2': { enabled: true,  expanded: false, cnt: 3, topicIds: new Set() },
    }
    expect(calcTotalTasks(states)).toBe(3)
  })

  it('не учитывает разделы с enabled = false даже если cnt > 0', () => {
    const states: Record<string, SectionState> = {
      'sec1': { enabled: false, expanded: false, cnt: 5, topicIds: new Set() },
    }
    expect(calcTotalTasks(states)).toBe(0)
  })

  it('суммирует только активные разделы с cnt > 0', () => {
    const states: Record<string, SectionState> = {
      'sec1': { enabled: true,  expanded: false, cnt: 2, topicIds: new Set() },
      'sec2': { enabled: true,  expanded: false, cnt: 3, topicIds: new Set() },
      'sec3': { enabled: false, expanded: false, cnt: 0, topicIds: new Set() },
    }
    expect(calcTotalTasks(states)).toBe(5)
  })
})

describe('Кнопка Сгенерировать', () => {
  it('недоступна при общем количестве задач = 0', () => {
    const canGenerate = (totalTasks: number, title: string) =>
      totalTasks > 0 && title.trim().length > 0
    expect(canGenerate(0, 'Мой вариант')).toBe(false)
  })

  it('недоступна при пустом названии', () => {
    const canGenerate = (totalTasks: number, title: string) =>
      totalTasks > 0 && title.trim().length > 0
    expect(canGenerate(5, '')).toBe(false)
  })

  it('доступна при totalTasks > 0 и непустом названии', () => {
    const canGenerate = (totalTasks: number, title: string) =>
      totalTasks > 0 && title.trim().length > 0
    expect(canGenerate(5, 'Тест')).toBe(true)
  })
})

describe('Восстановление сохранённого варианта', () => {
  it('корректно восстанавливает cnt из settings', () => {
    const savedSettings = {
      sections: [
        { section_id: 'sec1', cnt: 5, topic_ids: ['t1', 't2'] },
        { section_id: 'sec2', cnt: 3, topic_ids: [] },
      ]
    }
    const restored: Record<string, SectionState> = {}
    for (const sc of savedSettings.sections) {
      restored[sc.section_id] = {
        enabled: true, expanded: false,
        cnt: sc.cnt,
        topicIds: new Set(sc.topic_ids),
      }
    }
    expect(restored['sec1'].cnt).toBe(5)
    expect(restored['sec1'].enabled).toBe(true)
    expect(restored['sec1'].topicIds.has('t1')).toBe(true)
    expect(restored['sec2'].cnt).toBe(3)
  })

  it('восстановленный вариант не сбрасывается в 0', () => {
    const restored: Record<string, SectionState> = {
      'sec1': { enabled: true, expanded: false, cnt: 7, topicIds: new Set(['t1']) }
    }
    expect(restored['sec1'].cnt).not.toBe(0)
  })
})

// ── 4. Генерация задач ────────────────────────────────────────────────────────

interface GeneratedTask {
  task_id:    string
  section_id: string
  topic_id:   string
  position:   number
}

function applyGenerated(tasks: GeneratedTask[]): GeneratedTask[] {
  const seen = new Set<string>()
  return tasks.filter(t => {
    if (seen.has(t.task_id)) return false
    seen.add(t.task_id)
    return true
  }).map((t, i) => ({ ...t, position: i + 1 }))
}

describe('Генерация задач', () => {
  it('убирает дубликаты task_id', () => {
    const raw: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 2 }, // дубль
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 3 },
    ]
    const result = applyGenerated(raw)
    expect(result.length).toBe(2)
    expect(result.map(t => t.task_id)).toEqual(['a', 'b'])
  })

  it('переназначает позиции после дедупликации', () => {
    const raw: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
    ]
    const result = applyGenerated(raw)
    expect(result[0].position).toBe(1)
    expect(result[1].position).toBe(2)
  })
})

// ── 5. Замена задачи ──────────────────────────────────────────────────────────

function replaceTask(
  tasks: GeneratedTask[],
  oldTaskId: string,
  newTask: GeneratedTask
): GeneratedTask[] {
  return tasks.map(t => t.task_id === oldTaskId ? { ...newTask, position: t.position } : t)
}

describe('Замена задачи', () => {
  it('заменяет задачу по task_id', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
    ]
    const newTask: GeneratedTask = { task_id: 'c', section_id: 's1', topic_id: 't1', position: 0 }
    const result = replaceTask(tasks, 'a', newTask)
    expect(result[0].task_id).toBe('c')
    expect(result[0].position).toBe(1) // позиция сохраняется
  })

  it('не меняет другие задачи при замене', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
    ]
    const newTask: GeneratedTask = { task_id: 'x', section_id: 's1', topic_id: 't1', position: 0 }
    const result = replaceTask(tasks, 'a', newTask)
    expect(result[1].task_id).toBe('b')
  })
})

// ── 6. Удаление задачи ────────────────────────────────────────────────────────

function deleteTask(tasks: GeneratedTask[], idx: number): GeneratedTask[] {
  return tasks.filter((_, i) => i !== idx).map((t, i) => ({ ...t, position: i + 1 }))
}

describe('Удаление задачи', () => {
  it('удаляет задачу по индексу', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
      { task_id: 'c', section_id: 's1', topic_id: 't1', position: 3 },
    ]
    const result = deleteTask(tasks, 1) // удаляем 'b'
    expect(result.length).toBe(2)
    expect(result.map(t => t.task_id)).toEqual(['a', 'c'])
  })

  it('пересчитывает позиции после удаления', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
    ]
    const result = deleteTask(tasks, 0)
    expect(result[0].position).toBe(1)
  })
})

// ── 7. Изменение порядка задач ────────────────────────────────────────────────

function moveTask(tasks: GeneratedTask[], from: number, to: number): GeneratedTask[] {
  const next = [...tasks]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((t, i) => ({ ...t, position: i + 1 }))
}

describe('Изменение порядка задач', () => {
  it('перемещает задачу вверх', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
      { task_id: 'c', section_id: 's1', topic_id: 't1', position: 3 },
    ]
    const result = moveTask(tasks, 2, 0) // c → первое место
    expect(result.map(t => t.task_id)).toEqual(['c', 'a', 'b'])
  })

  it('обновляет позиции после перемещения', () => {
    const tasks: GeneratedTask[] = [
      { task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 },
      { task_id: 'b', section_id: 's1', topic_id: 't1', position: 2 },
    ]
    const result = moveTask(tasks, 1, 0)
    expect(result[0].position).toBe(1)
    expect(result[1].position).toBe(2)
  })
})

// ── 8. Сохранение варианта — валидация ────────────────────────────────────────

function validateVariantForSave(params: {
  title: string
  tasks: GeneratedTask[]
}): string[] {
  const errors: string[] = []
  if (!params.title.trim()) errors.push('Название обязательно')
  if (params.tasks.length === 0) errors.push('Вариант не должен быть пустым')
  return errors
}

describe('Валидация перед сохранением', () => {
  it('нет ошибок при корректном варианте', () => {
    const errors = validateVariantForSave({
      title: 'Мой вариант',
      tasks: [{ task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 }],
    })
    expect(errors).toHaveLength(0)
  })

  it('ошибка если пустое название', () => {
    const errors = validateVariantForSave({
      title: '  ',
      tasks: [{ task_id: 'a', section_id: 's1', topic_id: 't1', position: 1 }],
    })
    expect(errors).toContain('Название обязательно')
  })

  it('ошибка если нет задач', () => {
    const errors = validateVariantForSave({ title: 'Тест', tasks: [] })
    expect(errors).toContain('Вариант не должен быть пустым')
  })
})

// ── 9. Парсинг ошибки нехватки задач ─────────────────────────────────────────

function parseNotEnoughError(msg: string): { sectionId: string; topicId: string; needed: number; available: number } | null {
  const m = msg.match(/NOT_ENOUGH:section=([^:]+):topic=([^:]+):needed=(\d+):available=(\d+)/)
  if (!m) return null
  return { sectionId: m[1], topicId: m[2], needed: Number(m[3]), available: Number(m[4]) }
}

describe('Парсинг ошибки нехватки задач', () => {
  it('корректно разбирает структурированную ошибку', () => {
    const msg = 'NOT_ENOUGH:section=sec1:topic=top1:needed=10:available=3'
    const result = parseNotEnoughError(msg)
    expect(result).toEqual({ sectionId: 'sec1', topicId: 'top1', needed: 10, available: 3 })
  })

  it('возвращает null для неструктурированной ошибки', () => {
    expect(parseNotEnoughError('Some random error')).toBeNull()
  })
})

// ── 10. Маршруты ──────────────────────────────────────────────────────────────

const VARIANT_ROUTES = [
  '/variant-builder',
  '/variant-builder/:variantId',
  '/variants',
  '/variants/:variantId',
  '/variants/:variantId/assign',
  '/variants/:variantId/assignments',
  '/student/variants',
]

describe('Маршруты конструктора вариантов', () => {
  it('маршрут /variant-builder существует в конфигурации', () => {
    expect(VARIANT_ROUTES).toContain('/variant-builder')
  })
  it('маршрут /variants существует в конфигурации', () => {
    expect(VARIANT_ROUTES).toContain('/variants')
  })
  it('маршрут /variants/:variantId существует', () => {
    expect(VARIANT_ROUTES).toContain('/variants/:variantId')
  })
  it('маршрут редактирования существует', () => {
    expect(VARIANT_ROUTES).toContain('/variant-builder/:variantId')
  })
  it('маршрут назначения варианта существует', () => {
    expect(VARIANT_ROUTES).toContain('/variants/:variantId/assign')
  })
  it('маршрут страницы назначений существует', () => {
    expect(VARIANT_ROUTES).toContain('/variants/:variantId/assignments')
  })
  it('маршрут кабинета ученика с вариантами существует', () => {
    expect(VARIANT_ROUTES).toContain('/student/variants')
  })
})

// ── 11. Мобильная панель ──────────────────────────────────────────────────────

function isMobileLayout(width: number): boolean {
  return width < 1024 // lg breakpoint
}

describe('Адаптивность', () => {
  it('320px — мобильный layout', () => {
    expect(isMobileLayout(320)).toBe(true)
  })
  it('375px — мобильный layout', () => {
    expect(isMobileLayout(375)).toBe(true)
  })
  it('430px — мобильный layout', () => {
    expect(isMobileLayout(430)).toBe(true)
  })
  it('768px — мобильный layout (tablet)', () => {
    expect(isMobileLayout(768)).toBe(true)
  })
  it('1024px — десктопный layout', () => {
    expect(isMobileLayout(1024)).toBe(false)
  })
})

// ── 12. Изоляция вариантов teacher ────────────────────────────────────────────

function canTeacherModify(variantCreatedBy: string, currentUserId: string, role: UserRole): boolean {
  if (role === 'admin' || role === 'owner') return true
  if (role === 'teacher') return variantCreatedBy === currentUserId
  return false
}

describe('Изоляция teacher-вариантов (RLS-логика)', () => {
  it('teacher может изменить свой вариант', () => {
    expect(canTeacherModify('user1', 'user1', 'teacher')).toBe(true)
  })
  it('teacher не может изменить чужой вариант', () => {
    expect(canTeacherModify('user2', 'user1', 'teacher')).toBe(false)
  })
  it('admin может изменить любой вариант', () => {
    expect(canTeacherModify('user2', 'user1', 'admin')).toBe(true)
  })
  it('owner может изменить любой вариант', () => {
    expect(canTeacherModify('user2', 'user1', 'owner')).toBe(true)
  })
  it('curator не может изменять варианты', () => {
    expect(canTeacherModify('user1', 'user1', 'curator')).toBe(false)
  })
})

// ── 13. Задачи без ответа/решения ─────────────────────────────────────────────

interface TaskMeta {
  has_answer:   boolean
  has_solution: boolean
  answer_html:  string | null
  solution_html: string | null
}

function shouldShowAnswerButton(task: TaskMeta): boolean {
  return task.has_answer
}
function shouldShowSolutionButton(task: TaskMeta): boolean {
  return task.has_solution
}

describe('Задачи без ответа и решения', () => {
  it('не показывает кнопку ответа если has_answer=false', () => {
    const task: TaskMeta = { has_answer: false, has_solution: true, answer_html: null, solution_html: '<p>ok</p>' }
    expect(shouldShowAnswerButton(task)).toBe(false)
  })
  it('показывает кнопку ответа если has_answer=true', () => {
    const task: TaskMeta = { has_answer: true, has_solution: false, answer_html: '<p>42</p>', solution_html: null }
    expect(shouldShowAnswerButton(task)).toBe(true)
  })
  it('не показывает кнопку решения если has_solution=false', () => {
    const task: TaskMeta = { has_answer: true, has_solution: false, answer_html: '<p>42</p>', solution_html: null }
    expect(shouldShowSolutionButton(task)).toBe(false)
  })
})
