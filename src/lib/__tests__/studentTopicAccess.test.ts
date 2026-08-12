import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGroupIdByCourse, groupIdByCourse, myTopicHref } from '@/lib/studentTopicAccess'

/**
 * Доступ ученика к теме: карта «курс → группа» и адрес темы.
 *
 * Проверяется здесь, потому что именно расхождение двух источников адреса
 * (зачисления против членства) сделало карточки ДЗ неживыми у ученика с
 * курсом-черновиком — §123.3/§123.7.
 */

const eq = vi.fn()
const select = vi.fn((_columns: string) => ({ eq }))
const from = vi.fn((_table: string) => ({ select }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => from(table) },
}))

describe('groupIdByCourse', () => {
  it('строит карту курс → группа', () => {
    const map = groupIdByCourse([
      { group_id: 'g1', groups: { id: 'g1', course_id: 'c1' } },
      { group_id: 'g2', groups: { id: 'g2', course_id: 'c2' } },
    ])
    expect([...map]).toEqual([['c1', 'g1'], ['c2', 'g2']])
  })

  it('первая группа курса выигрывает — на дублях не падаем', () => {
    // Закон «один курс = одна группа» держит unique (§61), но старые данные
    // его переживали; вести себя предсказуемо дешевле, чем считать это невозможным.
    const map = groupIdByCourse([
      { groups: { id: 'g1', course_id: 'c1' } },
      { groups: { id: 'g2', course_id: 'c1' } },
    ])
    expect(map.get('c1')).toBe('g1')
  })

  it('строки без группы или без курса пропускаются, а не рождают битый адрес', () => {
    const map = groupIdByCourse([
      { groups: null },
      { groups: { id: 'g1', course_id: null } },
      { groups: { id: null, course_id: 'c1' } },
      null,
    ])
    expect(map.size).toBe(0)
  })
})

describe('fetchGroupIdByCourse', () => {
  beforeEach(() => {
    from.mockClear(); select.mockClear(); eq.mockClear()
  })

  it('читает членство ученика и не фильтрует по активности курса', async () => {
    eq.mockResolvedValue({ data: [{ groups: { id: 'g1', course_id: 'c1' } }] })

    const map = await fetchGroupIdByCourse('s1')

    expect(from).toHaveBeenCalledWith('group_students')
    expect(eq).toHaveBeenCalledWith('student_id', 's1')
    // Именно это и чинилось: курс-черновик доступа не лишает.
    const selectArg = String(select.mock.calls[0][0])
    expect(selectArg).not.toContain('is_active')
    expect(map.get('c1')).toBe('g1')
  })

  it('пустой ответ — пустая карта, а не падение', async () => {
    eq.mockResolvedValue({ data: null })
    expect((await fetchGroupIdByCourse('s1')).size).toBe(0)
  })
})

describe('myTopicHref', () => {
  it('собирает адрес темы в кабинете ученика', () => {
    expect(myTopicHref('g1', 't1')).toBe('/my-course/g1/topic/t1')
  })

  it('без группы адреса нет — карточка не должна вести в никуда', () => {
    expect(myTopicHref(null, 't1')).toBeNull()
    expect(myTopicHref(undefined, 't1')).toBeNull()
  })

  it('без темы адреса тоже нет', () => {
    expect(myTopicHref('g1', null)).toBeNull()
  })
})
