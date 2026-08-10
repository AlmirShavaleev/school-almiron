import { describe, expect, it } from 'vitest'
import { groupCoursesByTemplate, isArchived, type GroupableCourse } from '@/lib/courseGrouping'

const course = (id: string, over: Partial<GroupableCourse> = {}): GroupableCourse => ({
  id,
  title: id,
  is_active: true,
  is_draft: false,
  is_template: false,
  copied_from_course_id: null,
  ...over,
})

describe('isArchived', () => {
  /**
   * Замечание оркестратора 10.08, из-за которого правило вынесено в функцию:
   * свежая копия рождается неактивным ЧЕРНОВИКОМ, и архив по одному
   * `is_active` увёл бы туда обе живые копии в первый же день.
   */
  it('неактивный черновик — не архив', () => {
    expect(isArchived(course('c', { is_active: false, is_draft: true }))).toBe(false)
  })

  it('архив — неактивный и не черновик', () => {
    expect(isArchived(course('c', { is_active: false, is_draft: false }))).toBe(true)
  })

  it('активный курс — не архив', () => {
    expect(isArchived(course('c'))).toBe(false)
  })
})

describe('groupCoursesByTemplate', () => {
  it('копия встаёт под свой шаблон, а не в общий ряд', () => {
    const tpl = course('tpl', { is_template: true })
    const copy = course('copy', { copied_from_course_id: 'tpl' })

    const { groups, loose } = groupCoursesByTemplate([tpl, copy])

    expect(groups).toHaveLength(1)
    expect(groups[0].template.id).toBe('tpl')
    expect(groups[0].copies.map(c => c.id)).toEqual(['copy'])
    expect(loose).toHaveLength(0)
  })

  it('копия-черновик остаётся под шаблоном, а не уезжает в архив', () => {
    const tpl = course('tpl', { is_template: true })
    const copy = course('copy', { is_active: false, is_draft: true, copied_from_course_id: 'tpl' })

    const { groups, archived } = groupCoursesByTemplate([tpl, copy])

    expect(groups[0].copies.map(c => c.id)).toEqual(['copy'])
    expect(archived).toHaveLength(0)
  })

  it('шаблон без копий — карточка без полки детей', () => {
    const { groups, loose } = groupCoursesByTemplate([course('tpl', { is_template: true })])

    expect(groups).toHaveLength(1)
    expect(groups[0].copies).toEqual([])
    expect(loose).toHaveLength(0)
  })

  it('копия без живого шаблона не пропадает — идёт обычной карточкой', () => {
    // Шаблон удалён: ссылка обнулилась (on delete set null) либо ведёт в никуда.
    const orphan = course('orphan', { copied_from_course_id: 'удалённый' })
    const noParent = course('сам-по-себе')

    const { groups, loose } = groupCoursesByTemplate([orphan, noParent])

    expect(groups).toHaveLength(0)
    expect(loose.map(c => c.id)).toEqual(['orphan', 'сам-по-себе'])
  })

  it('в архив карточка уходит сама по себе, без родства', () => {
    const tpl = course('tpl', { is_template: true })
    const live = course('живая', { copied_from_course_id: 'tpl' })
    const gone = course('убранная', { is_active: false, copied_from_course_id: 'tpl' })

    const { groups, archived } = groupCoursesByTemplate([tpl, live, gone])

    expect(groups[0].copies.map(c => c.id)).toEqual(['живая'])
    expect(archived.map(c => c.id)).toEqual(['убранная'])
  })

  it('архивный шаблон не тянет за собой живые копии', () => {
    const tpl = course('tpl', { is_template: true, is_active: false })
    const copy = course('copy', { copied_from_course_id: 'tpl' })

    const { groups, loose, archived } = groupCoursesByTemplate([tpl, copy])

    expect(groups).toHaveLength(0)
    expect(archived.map(c => c.id)).toEqual(['tpl'])
    expect(loose.map(c => c.id)).toEqual(['copy'])
  })

  it('копия обычного курса — обычная карточка: вкладывать не во что', () => {
    const plain = course('обычный')
    const copy = course('копия', { copied_from_course_id: 'обычный' })

    const { groups, loose } = groupCoursesByTemplate([plain, copy])

    expect(groups).toHaveLength(0)
    expect(loose.map(c => c.id)).toEqual(['обычный', 'копия'])
  })

  it('у шаблона несколько копий, порядок входа сохраняется', () => {
    const tpl = course('tpl', { is_template: true })
    const a = course('11А', { copied_from_course_id: 'tpl' })
    const b = course('11Б', { copied_from_course_id: 'tpl' })

    const { groups } = groupCoursesByTemplate([tpl, a, b])

    expect(groups[0].copies.map(c => c.id)).toEqual(['11А', '11Б'])
  })

  it('ни один курс не теряется', () => {
    const all = [
      course('tpl', { is_template: true }),
      course('copy', { copied_from_course_id: 'tpl' }),
      course('draft-copy', { is_draft: true, is_active: false, copied_from_course_id: 'tpl' }),
      course('plain'),
      course('archived', { is_active: false }),
    ]

    const { groups, loose, archived } = groupCoursesByTemplate(all)
    const seen = [
      ...groups.flatMap(g => [g.template.id, ...g.copies.map(c => c.id)]),
      ...loose.map(c => c.id),
      ...archived.map(c => c.id),
    ]

    expect(seen.sort()).toEqual(all.map(c => c.id).sort())
  })
})
