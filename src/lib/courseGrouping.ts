/**
 * Раскладка списка «Курсы»: шаблон главной карточкой, его копии — рядом под ним.
 *
 * Логика вынесена из страницы отдельной функцией не ради красоты: страница
 * `CourseProgramPage` перевалила за две тысячи строк, и правило «что где
 * рисуется» иначе нечем проверить, кроме как глазами на проде (§113).
 */

/** Что раскладке нужно знать о курсе. Больше полей она не смотрит. */
export interface GroupableCourse {
  id: string
  title: string
  is_active: boolean
  is_draft: boolean
  is_template: boolean
  copied_from_course_id: string | null
}

export interface CourseGroup<T extends GroupableCourse> {
  template: T
  copies: T[]
}

export interface GroupedCourses<T extends GroupableCourse> {
  /** Шаблоны со своими копиями. */
  groups: CourseGroup<T>[]
  /** Всё остальное живое: обычные курсы и копии, потерявшие шаблон. */
  loose: T[]
  /** Убранное в архив — плоским списком, без родства. */
  archived: T[]
}

/**
 * Архив — это то, что убрали ОСОЗНАННО, а не всё неактивное.
 *
 * Различие не косметическое. Свежая копия курса рождается `is_draft = true,
 * is_active = false` (см. `course_copy_stage`), и ключуйся архив по одному
 * `is_active`, обе копии в первый же день уехали бы в архив, а полки под
 * шаблонами опустели бы. Черновик — это «ещё не запустили», архив — «больше
 * не ведём».
 */
export function isArchived(course: GroupableCourse): boolean {
  return !course.is_active && !course.is_draft
}

/**
 * Раскладывает курсы по шаблонам.
 *
 * Правила, о которые легко споткнуться:
 *
 *  - В архив карточка уходит САМА ПО СЕБЕ, без родства (решение владельца
 *    09.08). Архивная копия под активным шаблоном воскрешала бы в списке то,
 *    что оттуда убрали намеренно.
 *  - Копия, чей шаблон удалён или сам лежит в архиве, не пропадает: она
 *    показывается обычной карточкой в общем ряду. Потерять курс из списка
 *    страшнее, чем показать его без родителя.
 *  - Шаблон без копий — просто карточка с бейджем, пустой «полки детей» нет.
 *  - Порядок внутри рядов сохраняется входной (страница сортирует по названию).
 */
export function groupCoursesByTemplate<T extends GroupableCourse>(courses: T[]): GroupedCourses<T> {
  const archived: T[] = []
  const live: T[] = []
  for (const c of courses) (isArchived(c) ? archived : live).push(c)

  const templates = live.filter(c => c.is_template)
  const templateIds = new Set(templates.map(t => t.id))

  const copiesByTemplate = new Map<string, T[]>()
  const loose: T[] = []

  for (const c of live) {
    if (c.is_template) continue
    const parent = c.copied_from_course_id
    // Родитель должен быть жив и быть шаблоном: копия обычного курса — просто
    // курс, вкладывать её некуда, и родословная тут ничего не объясняет.
    if (parent && templateIds.has(parent)) {
      const list = copiesByTemplate.get(parent) ?? []
      list.push(c)
      copiesByTemplate.set(parent, list)
    } else {
      loose.push(c)
    }
  }

  return {
    groups: templates.map(template => ({ template, copies: copiesByTemplate.get(template.id) ?? [] })),
    loose,
    archived,
  }
}
