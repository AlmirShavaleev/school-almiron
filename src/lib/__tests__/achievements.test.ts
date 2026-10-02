import { describe, expect, it } from 'vitest'
import {
  achievementHint, achievementLabel, achievementName, achievementNameByKey, achievementStats, achievementToastText,
  buildLadders, filterLadders, latestEarned, nearest, normalizeAchievements, pointsText, type AchievementItem,
} from '@/lib/achievements'
import { syncResponse } from '@/test/achievementsFixture'

/**
 * §257. «Достижения»: разбор ответа базы, лестницы, ближайшие, фильтр, тексты.
 * Пороги, уровни и баллы — из ответа (таблица achievement_rules в базе);
 * клиент их не держит, поэтому тест подсовывает ответ и смотрит поведение.
 */
const HAVE = { catalog: 23, hw: 18, ontime: 14, five: 3, mock: 1, mockscore: 80, streak: 9, daily: 4, weekly: 1, confident: 5, closed: 2, forecast: 6, tests: 2, topics: 15, redo: 1, 'special:flawless': 10, 'special:early': 1 }
const parse = (o = {}) => normalizeAchievements(syncResponse({ have: HAVE, ...o }))!

describe('достижения: ответ базы', () => {
  it('79 наград в 16 категориях; уровень и баллы — из ответа; незнакомое отбрасывается', () => {
    const a = parse()
    expect(a.total).toBe(79)
    expect(a.items).toHaveLength(79)
    expect(new Set(a.items.map(i => i.category)).size).toBe(16)
    // лестница каталога: бронза ×3, серебро ×3, золото ×2, легенда — по месту, как в базе
    expect(a.items.filter(i => i.category === 'catalog').map(i => i.tier)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 4])
    expect(a.items.filter(i => i.category === 'forecast').every(i => i.points === 0)).toBe(true)
    const raw = syncResponse()
    raw.items.push({ key: 'x:1', category: 'nope', threshold: 1, tier: 1, points: 10, have: 0, need: 1, earned_at: null, is_new: false, fresh: false })
    expect(normalizeAchievements(raw)!.items).toHaveLength(79)
    expect(normalizeAchievements(null)).toBeNull()
    expect(normalizeAchievements({ total: 79 })).toBeNull()
  })

  it('владелец поменял стоимость в базе — клиент показывает новую без правки', () => {
    const raw = syncResponse({ have: HAVE })
    ;(raw.items[0] as Record<string, unknown>).points = 15
    const a = normalizeAchievements(raw)!
    expect(a.items[0].points).toBe(15)
    expect(achievementHint(a.items[0])).toContain('+15 баллов школы')
  })

  it('счётчики: награды из 79, задачи каталога, сданные ДЗ, рекорд серии — «have» из ответа', () => {
    const a = parse()
    expect(achievementStats(a)).toEqual({ earned: a.earned, total: 79, catalog: 23, hw: 18, streak: 9 })
  })
})

describe('достижения: лестницы', () => {
  it('полученные — цветом, следующая — «23 из 50» с долей от прошлого порога, остальные серые', () => {
    const cat = buildLadders(parse()).find(l => l.category === 'catalog')!
    expect(cat.tiles.map(t => t.state)).toEqual(['earned', 'earned', 'earned', 'earned', 'current', 'locked', 'locked', 'locked', 'locked'])
    const cur = cat.tiles[4]
    expect(cur.sub).toBe('23 из 50')
    expect(cur.progress).toBeCloseTo((23 - 20) / (50 - 20))
    expect(cat.got).toBe(4)
    expect(cat.count).toBe(9)
  })

  it('«не отнимается»: have упал ниже порога, а награда получена — плитка остаётся полученной', () => {
    const a = parse({ have: { ...HAVE, catalog: 4 }, keep: ['catalog:5', 'catalog:10', 'catalog:20'] })
    const cat = buildLadders(a).find(l => l.category === 'catalog')!
    expect(cat.tiles.slice(0, 4).map(t => t.state)).toEqual(['earned', 'earned', 'earned', 'earned'])
    expect(cat.tiles[4]).toMatchObject({ state: 'current', sub: '4 из 50' })
    expect(cat.tiles[4].progress).toBe(0)
  })

  it('особые — без «текущей»: каждая сама по себе, «9 из 30» у начатых, «как получить» у остальных', () => {
    const sp = buildLadders(parse({ have: { ...HAVE, 'special:marathon': 9 } })).find(l => l.category === 'special')!
    expect(sp.tiles.some(t => t.state === 'current')).toBe(false)
    expect(sp.tiles.find(t => t.item.key === 'special:flawless')!.state).toBe('earned')
    expect(sp.tiles.find(t => t.item.key === 'special:marathon')!.sub).toBe('9 из 30')
    expect(sp.tiles.find(t => t.item.key === 'special:goal')!.sub).toBe('Примерный балл ЕГЭ дошёл до вашей цели')
  })

  it('ближайшие — 4 текущие ступени с наибольшей долей пути', () => {
    const near = nearest(buildLadders(parse()))
    expect(near).toHaveLength(4)
    for (let i = 1; i < near.length; i++) expect(near[i - 1].progress).toBeGreaterThanOrEqual(near[i].progress)
    // результат пробника 80 → 90: доля (80 − 80) / 10 = 0 — в ближайших его нет
    expect(near.map(n => n.item.key)).not.toContain('mockscore:90')
    const all = buildLadders(parse()).flatMap(l => l.tiles.filter(t => t.state === 'current'))
    const best = [...all].sort((x, y) => y.progress - x.progress)[0]
    expect(near[0].item.key).toBe(best.item.key)
    expect(near[0].left).toBe(near[0].item.need - near[0].item.have)
  })

  it('фильтр: «Полученные» — только полученные, «Ближайшие» — только текущие, категория — одна; пустые прячутся', () => {
    const ladders = buildLadders(parse())
    const done = filterLadders(ladders, 'done')
    expect(done.every(l => l.tiles.every(t => t.state === 'earned'))).toBe(true)
    expect(done.some(l => l.category === 'weekly')).toBe(true)
    const near = filterLadders(ladders, 'near')
    expect(near.every(l => l.tiles.length === 1 && l.tiles[0].state === 'current')).toBe(true)
    expect(near.some(l => l.category === 'special')).toBe(false)
    expect(filterLadders(ladders, 'streak').map(l => l.category)).toEqual(['streak'])
    expect(filterLadders(ladders, 'all')).toHaveLength(16)
    const newbie = buildLadders(normalizeAchievements(syncResponse())!)
    expect(filterLadders(newbie, 'done')).toEqual([])
  })
})

describe('достижения: тексты', () => {
  const item = (key: string, over: Partial<AchievementItem> = {}): AchievementItem => {
    const a = parse()
    return { ...a.items.find(i => i.key === key)!, ...over }
  }

  it('подписи плиток и полные имена со склонением', () => {
    expect(achievementLabel(item('catalog:20'))).toBe('20 задач')
    expect(achievementName(item('catalog:1'))).toBe('1 задача каталога')
    expect(achievementName(item('hw:20'))).toBe('20 ДЗ')
    expect(achievementLabel(item('mockscore:80'))).toBe('80+ баллов')
    expect(achievementName(item('mockscore:27'))).toBe('Пробник на 27+')
    expect(achievementName(item('streak:3'))).toBe('Серия 3 дня')
    expect(achievementName(item('streak:14'))).toBe('Серия 14 дней')
    expect(achievementName(item('five:1'))).toBe('1 пятёрка за ДЗ')
    expect(achievementLabel(item('forecast:5'))).toBe('+5 баллов')
    expect(achievementName(item('special:flawless'))).toBe('Без ошибок')
    expect(achievementNameByKey('daily:7')).toBe('7 задач дня')
    expect(achievementNameByKey('special:full_kim')).toBe('Полный КИМ')
    expect(achievementNameByKey('мусор')).toBe('мусор')
  })

  it('подсказка «как получить» + баллы + сколько есть; прогноз — без баллов школы', () => {
    expect(achievementHint(item('catalog:50'))).toBe('Решите верно 50 задач каталога с проверкой ответа · +25 баллов школы · пока 23 из 50')
    expect(achievementHint(item('catalog:1'))).toBe('Решите верно 1 задачу каталога с проверкой ответа · +10 баллов школы · получено')
    expect(achievementHint(item('forecast:10'))).toBe('Поднимите примерный балл ЕГЭ на 10 баллов от первого показа · без баллов школы: прогноз считается на вашем устройстве · пока 6 из 10')
    expect(achievementHint(item('special:goal'))).toContain('без баллов школы')
    expect(pointsText(0)).toBe('значок')
    expect(pointsText(25)).toBe('+25')
  })

  it('тост: «Новая награда: 20 ДЗ · +25»; несколько — две самые дорогие и «и ещё N»; прогноз — без «+0»', () => {
    expect(achievementToastText([item('hw:20')])).toBe('Новая награда: 20 ДЗ · +25')
    expect(achievementToastText([item('forecast:5')])).toBe('Новая награда: Прогноз +5')
    expect(achievementToastText([item('catalog:1'), item('hw:20'), item('special:flawless'), item('streak:3')]))
      .toBe('Новые награды: Без ошибок · +50, 20 ДЗ · +25 и ещё 2')
    expect(achievementToastText([])).toBeNull()
  })

  it('последние полученные — по моменту получения, новые первыми', () => {
    const a = parse({ earnedAt: { 'hw:10': '2026-10-02T10:00:00Z', 'streak:7': '2026-10-01T10:00:00Z', 'catalog:20': '2026-10-02T12:00:00Z' } })
    expect(latestEarned(a, 3).map(i => i.key)).toEqual(['catalog:20', 'hw:10', 'streak:7'])
    expect(latestEarned(normalizeAchievements(syncResponse())!)).toEqual([])
  })
})
