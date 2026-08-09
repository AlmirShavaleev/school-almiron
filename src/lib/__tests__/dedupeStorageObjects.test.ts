import { describe, expect, it } from 'vitest'
// @ts-expect-error — скрипт на .mjs без типов, тестируем его чистые функции
import { cacheControlIsBad, foldersOf, groupDuplicates, isRefcountable } from '../../../scripts/dedupe-storage-objects.mjs'

/**
 * Скрипт удаляет данные в проде, поэтому решающие функции проверяются здесь, а
 * не глазами по логу: какие объекты считаются одинаковыми, кого из группы
 * оставляем и что считается негодным кэшем.
 */

const obj = (name: string, etag: string, size = 100, extra: Record<string, unknown> = {}) => ({
  bucket: 'topic-materials', name, etag, size,
  cacheControl: 'max-age=3600', mimetype: 'application/pdf', createdAt: '2026-08-01T00:00:00Z',
  ...extra,
})

describe('cacheControlIsBad', () => {
  it.each(['no-cache', 'max-age=0', '0', '', null, undefined, 'private'])('негодный: %s', (v) => {
    expect(cacheControlIsBad(v)).toBe(true)
  })

  it.each(['max-age=3600', 'max-age=31536000', 'max-age=1'])('годный: %s', (v) => {
    expect(cacheControlIsBad(v)).toBe(false)
  })
})

describe('foldersOf', () => {
  it('берёт первый сегмент и не повторяется', () => {
    expect(foldersOf(['t1/a.pdf', 't1/b.pdf', 't2/c.pdf'])).toEqual(['t1', 't2'])
  })

  it('путь без папки пропускает — по нему Storage список не отдаст', () => {
    expect(foldersOf(['file.pdf', '/leading.pdf'])).toEqual([])
  })
})

describe('groupDuplicates', () => {
  const refs = new Map<string, number>()

  it('одинаковые по содержимому, разные по имени — одна группа', () => {
    const groups = groupDuplicates([obj('t1/копия.pdf', 'aaa'), obj('t2/оригинал.pdf', 'aaa')], refs)
    expect(groups).toHaveLength(1)
    expect(groups[0].duplicates).toHaveLength(1)
  })

  it('одинаковый хеш при разном размере — НЕ дубли', () => {
    const groups = groupDuplicates([obj('t1/a.pdf', 'aaa', 100), obj('t2/b.pdf', 'aaa', 200)], refs)
    expect(groups).toHaveLength(0)
  })

  it('одинаковое имя при разном содержимом — не дубли', () => {
    const groups = groupDuplicates([obj('t1/конспект.pdf', 'aaa'), obj('t2/конспект.pdf', 'bbb')], refs)
    expect(groups).toHaveLength(0)
  })

  /** eTag составной загрузки — не md5 целого файла, сравнивать им нельзя. */
  it('составной eTag не участвует', () => {
    const groups = groupDuplicates([obj('t1/a.pdf', 'aaa-2'), obj('t2/b.pdf', 'aaa-2')], refs)
    expect(groups).toHaveLength(0)
  })

  it('пустые объекты не схлопываются', () => {
    const groups = groupDuplicates([obj('t1/a.pdf', 'aaa', 0), obj('t2/b.pdf', 'aaa', 0)], refs)
    expect(groups).toHaveLength(0)
  })

  it('хранитель — тот, на кого больше ссылок: меньше строк переписывать', () => {
    const counted = new Map([['t2/популярный.pdf', 5], ['t1/одинокий.pdf', 1]])
    const groups = groupDuplicates([obj('t1/одинокий.pdf', 'aaa'), obj('t2/популярный.pdf', 'aaa')], counted)
    expect(groups[0].keeper.name).toBe('t2/популярный.pdf')
  })

  it('при равенстве ссылок хранитель — самый старый', () => {
    const groups = groupDuplicates([
      obj('t1/новый.pdf', 'aaa', 100, { createdAt: '2026-08-05T00:00:00Z' }),
      obj('t2/старый.pdf', 'aaa', 100, { createdAt: '2026-01-01T00:00:00Z' }),
    ], refs)
    expect(groups[0].keeper.name).toBe('t2/старый.pdf')
  })

  /** Разведка и реальный проход обязаны выбрать одно и то же. */
  it('выбор детерминирован: тот же вход — тот же план', () => {
    const input = [obj('t1/a.pdf', 'aaa'), obj('t2/b.pdf', 'aaa'), obj('t3/c.pdf', 'aaa')]
    const first = groupDuplicates(input, refs)
    const second = groupDuplicates([...input].reverse(), refs)

    expect(second[0].keeper.name).toBe(first[0].keeper.name)
    expect(second[0].duplicates.map((d: { name: string }) => d.name).sort())
      .toEqual(first[0].duplicates.map((d: { name: string }) => d.name).sort())
  })

  it('объекты разных бакетов в одну группу не сходятся', () => {
    const groups = groupDuplicates([
      obj('t1/a.pdf', 'aaa'),
      { ...obj('t1/a.pdf', 'aaa'), bucket: 'topic-homework' },
    ], refs)
    expect(groups).toHaveLength(0)
  })

  it('в группе из трёх остаётся один хранитель и два лишних', () => {
    const groups = groupDuplicates([obj('t1/a.pdf', 'aaa'), obj('t2/b.pdf', 'aaa'), obj('t3/c.pdf', 'aaa')], refs)
    expect(groups[0].duplicates).toHaveLength(2)
    expect(groups[0].duplicates.map((d: { name: string }) => d.name)).not.toContain(groups[0].keeper.name)
  })
})

/**
 * Правка после проверки оркестратора 09.08. `storage_path_refs` умеет ровно два
 * бакета; для любого другого обе её ветки дают ноль, и «ссылок нет» становится
 * неотличимо от «нечем считать». На сдачах учеников и материалах шаблонов это
 * означало бы удаление живых файлов по формально честному нулю — тот же класс
 * молчаливого отказа, что в §47 и §54.
 */
describe('Белый список бакетов', () => {
  it('считать ссылки умеем только там, где их правда считают', () => {
    expect(isRefcountable('topic-materials')).toBe(true)
    expect(isRefcountable('topic-homework')).toBe(true)
  })

  it.each(['topic-homework-attempts', 'lesson-library', 'homeworks', 'course-materials', '', 'topic-materials '])(
    'бакет вне списка не считается пригодным: %s',
    (bucket) => {
      expect(isRefcountable(bucket)).toBe(false)
    },
  )
})
