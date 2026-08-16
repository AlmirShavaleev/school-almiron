import { describe, expect, it } from 'vitest'
import { enrollableGroups, isTemplateGroup } from '@/lib/enrollmentTargets'

/**
 * Правило одно на четыре списка выбора курса. Проверяется здесь, а не в каждой
 * странице: копия правила в тесте зеленела бы, даже если списки разъедутся.
 */

const group = (over: Partial<{ course_id: string | null; is_template: boolean | null; title: string }> = {}) => ({
  id: 'g',
  name: 'Группа',
  course_id: over.course_id === undefined ? 'c1' : over.course_id,
  courses: over.course_id === null
    ? null
    : { title: over.title ?? 'Курс', is_template: over.is_template ?? false },
})

describe('enrollmentTargets', () => {
  it('группа курса-шаблона не годится для зачисления', () => {
    expect(isTemplateGroup(group({ is_template: true }))).toBe(true)
  })

  it('обычная группа годится', () => {
    expect(isTemplateGroup(group())).toBe(false)
  })

  it('отбор идёт по ПОЛЮ, а не по слову «Шаблон» в названии', () => {
    // На проде есть «Физика ЕГЭ Шаблон -Ярослав» с is_template = false — это
    // настоящий класс. Фильтр по тексту спрятал бы его от преподавателя.
    const realClass = group({ is_template: false, title: 'Физика ЕГЭ Шаблон -Ярослав' })
    expect(isTemplateGroup(realClass)).toBe(false)
    expect(enrollableGroups([realClass])).toHaveLength(1)
  })

  it('группа без курса остаётся в списке — это подсказка «назначьте курс»', () => {
    const noCourse = group({ course_id: null })
    expect(isTemplateGroup(noCourse)).toBe(false)
    expect(enrollableGroups([noCourse])).toHaveLength(1)
  })

  it('из списка уходят только шаблоны', () => {
    const kept = [group(), group({ course_id: null }), group({ is_template: false })]
    const dropped = [group({ is_template: true }), group({ is_template: true })]
    expect(enrollableGroups([...kept, ...dropped])).toHaveLength(kept.length)
  })

  it('отсутствие сведений о курсе не считается шаблоном', () => {
    // Недогруженный джойн не должен молча выбрасывать живые группы из списка.
    expect(isTemplateGroup({ course_id: 'c1' })).toBe(false)
    expect(isTemplateGroup({ course_id: 'c1', courses: { is_template: null } })).toBe(false)
  })
})
