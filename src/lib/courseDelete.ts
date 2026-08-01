import { supabase } from '@/lib/supabase'

/**
 * Удаление курса — клиентская половина.
 *
 * Два шага, как у копирования, и по той же причине: объекты в хранилище
 * Postgres удалить не может.
 *
 *   1. course_delete_preview  — только считает. Диалог показывает точные
 *      числа: «Вы уверены?» без чисел ничего не сообщает.
 *   2. course_delete_execute  — сносит курс и возвращает список файлов;
 *      этот модуль вычищает их из хранилища.
 *
 * Файлы удаляются ПОСЛЕ базы и только по факту успеха. Если зачистка сорвётся,
 * останется мусор в бакете — неприятно, но курс уже удалён корректно. Обратный
 * порядок дал бы живой курс со ссылками в пустоту, и это хуже.
 */

export interface CourseDeleteCounts {
  modules: number
  topics: number
  materials: number
  homework: number
  attempts: number
  test_attempts: number
  groups: number
  lessons: number
  files: number
}

/** Почему удалить нельзя. `active` снимается архивированием, остальные — нет. */
export type CourseDeleteBlockerCode = 'students' | 'transactions' | 'active'

export interface CourseDeleteBlocker {
  code: CourseDeleteBlockerCode
  count: number
}

export interface CourseDeletePreview {
  courseId: string
  title: string
  counts: CourseDeleteCounts
  blockers: CourseDeleteBlocker[]
}

export interface CourseDeleteResult {
  /** Сколько объектов вычищено из хранилища. */
  removedFiles: number
  /** Сколько не удалось убрать: курс уже удалён, это просто мусор. */
  failedFiles: number
}

const EMPTY_COUNTS: CourseDeleteCounts = {
  modules: 0, topics: 0, materials: 0, homework: 0,
  attempts: 0, test_attempts: 0, groups: 0, lessons: 0, files: 0,
}

/** «1 тема / 2 темы / 5 тем» — счёт без склонения читается как машинный. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  switch (n % 10) {
    case 1: return one
    case 2:
    case 3:
    case 4: return few
    default: return many
  }
}

/**
 * Строки для списка «что исчезнет». Нулевые позиции опускаем: строка
 * «0 сданных работ» создаёт впечатление, что чего-то нет, хотя её просто
 * не должно быть на экране.
 */
export function describeDeletion(counts: CourseDeleteCounts): string[] {
  const out: string[] = []
  const add = (n: number, one: string, few: string, many: string) => {
    if (n > 0) out.push(`${n} ${plural(n, one, few, many)}`)
  }
  add(counts.topics, 'тема', 'темы', 'тем')
  add(counts.materials, 'материал', 'материала', 'материалов')
  add(counts.homework, 'домашнее задание', 'домашних задания', 'домашних заданий')
  add(counts.attempts, 'сданная работа', 'сданные работы', 'сданных работ')
  add(counts.test_attempts, 'попытка по тесту', 'попытки по тестам', 'попыток по тестам')
  add(counts.groups, 'группа', 'группы', 'групп')
  add(counts.lessons, 'занятие', 'занятия', 'занятий')
  add(counts.files, 'файл', 'файла', 'файлов')
  return out
}

/** Человеческое объяснение запрета — вместе с тем, что с ним делать. */
export function describeBlocker(blocker: CourseDeleteBlocker): string {
  switch (blocker.code) {
    case 'students':
      return `На курсе ${blocker.count} ${plural(blocker.count, 'ученик', 'ученика', 'учеников')}. ` +
        'Сначала отчислите их на вкладке «Ученики» — иначе пропадёт их история.'
    case 'transactions':
      return `За занятиями курса числится ${blocker.count} ` +
        `${plural(blocker.count, 'денежная операция', 'денежные операции', 'денежных операций')}. ` +
        'Такой курс удалять нельзя.'
    case 'active':
      return 'Курс действующий. Сначала уберите его в архив — переключателем «Курс активен» в настройках.'
  }
}

export async function previewCourseDeletion(courseId: string): Promise<CourseDeletePreview> {
  const { data, error } = await supabase.rpc('course_delete_preview', { p_course_id: courseId } as never)
  if (error) throw new Error(error.message)

  const raw = data as {
    course_id?: string
    title?: string
    counts?: Partial<CourseDeleteCounts>
    blockers?: CourseDeleteBlocker[]
  } | null
  if (!raw?.course_id) throw new Error('Не удалось посчитать содержимое курса')

  return {
    courseId: raw.course_id,
    title: raw.title ?? '',
    counts: { ...EMPTY_COUNTS, ...(raw.counts ?? {}) },
    blockers: Array.isArray(raw.blockers) ? raw.blockers : [],
  }
}

/**
 * Удаляет курс и вычищает его файлы.
 *
 * Ошибки зачистки НЕ пробрасываются: курс к этому моменту уже удалён, и
 * падение здесь заставило бы преподавателя думать, что операция не прошла, и
 * жать кнопку снова — по несуществующему курсу.
 */
export async function deleteCourse(courseId: string): Promise<CourseDeleteResult> {
  const { data, error } = await supabase.rpc('course_delete_execute', { p_course_id: courseId } as never)
  if (error) throw new Error(error.message)

  const files = ((data as { files?: unknown } | null)?.files ?? []) as { bucket: string; path: string }[]
  if (!Array.isArray(files) || files.length === 0) return { removedFiles: 0, failedFiles: 0 }

  const byBucket = new Map<string, string[]>()
  for (const f of files) {
    if (!f?.bucket || !f?.path) continue
    const list = byBucket.get(f.bucket) ?? []
    list.push(f.path)
    byBucket.set(f.bucket, list)
  }

  let removed = 0
  let failed = 0
  for (const [bucket, paths] of byBucket) {
    // Storage не любит списки в тысячи ключей — режем на порции.
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100)
      try {
        const { error: rmError } = await supabase.storage.from(bucket).remove(chunk)
        if (rmError) failed += chunk.length
        else removed += chunk.length
      } catch {
        failed += chunk.length
      }
    }
  }

  return { removedFiles: removed, failedFiles: failed }
}
