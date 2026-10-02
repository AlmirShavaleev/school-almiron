/**
 * §257. «Достижения» — разбор ответа `student_achievements_sync()` и тексты.
 *
 * Пороги, уровень награды (бронза / серебро / золото / легенда), баллы и
 * «have» считает база: правила — одна таблица `achievement_rules()`, полученные
 * награды хранятся в `student_achievements` и не отнимаются. Здесь своих чисел
 * нет — только слова: название категории, подпись награды, подсказка «как
 * получить», порядок ближайших, фильтр. Склонения — `plural.ts`.
 */
import { plural } from '@/lib/plural'

export type AchievementCategory =
  | 'catalog' | 'hw' | 'ontime' | 'five' | 'mock' | 'mockscore' | 'streak' | 'daily' | 'weekly'
  | 'confident' | 'closed' | 'forecast' | 'tests' | 'topics' | 'redo' | 'special'

/** 1 бронза, 2 серебро, 3 золото, 4 легенда. */
export type Tier = 1 | 2 | 3 | 4

export interface AchievementItem {
  key:       string
  category:  AchievementCategory
  threshold: number
  tier:      Tier
  /** Баллы школы за награду; 0 — значок без баллов (прогноз считает устройство). */
  points:    number
  have:      number
  need:      number
  /** Получена (и навсегда): момент события; null — ещё нет. */
  earnedAt:  string | null
  /** Получена и ещё не просмотрена на странице «Достижения». */
  isNew:     boolean
  /** Вставлена ЭТИМ вызовом sync — для тоста «Новая награда» (ровно один раз). */
  fresh:     boolean
}

export interface Achievements {
  total:    number
  earned:   number
  newCount: number
  tiers:    { tier: Tier; points: number }[]
  items:    AchievementItem[]
}

export const CATEGORY_ORDER: readonly AchievementCategory[] = [
  'catalog', 'hw', 'ontime', 'five', 'mock', 'mockscore', 'streak', 'daily', 'weekly',
  'confident', 'closed', 'forecast', 'tests', 'topics', 'redo', 'special',
]

export const TIER_NAME: Record<Tier, string> = { 1: 'бронза', 2: 'серебро', 3: 'золото', 4: 'легенда' }

const isCategory = (v: unknown): v is AchievementCategory => CATEGORY_ORDER.includes(v as AchievementCategory)
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const tierOf = (v: unknown): Tier => {
  const n = Math.round(num(v, 1))
  return (n >= 1 && n <= 4 ? n : 1) as Tier
}

/** Ответ базы → структура страницы. Незнакомые категории и пустые ключи — мимо. */
export function normalizeAchievements(raw: unknown): Achievements | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.items)) return null
  const items: AchievementItem[] = []
  for (const x of r.items as unknown[]) {
    const o = (x ?? {}) as Record<string, unknown>
    if (typeof o.key !== 'string' || !isCategory(o.category)) continue
    const threshold = Math.max(0, Math.round(num(o.threshold)))
    items.push({
      key: o.key,
      category: o.category,
      threshold,
      tier: tierOf(o.tier),
      points: Math.max(0, Math.round(num(o.points))),
      have: Math.max(0, Math.round(num(o.have))),
      need: Math.max(1, Math.round(num(o.need, threshold || 1))),
      earnedAt: typeof o.earned_at === 'string' ? o.earned_at : null,
      isNew: o.is_new === true,
      fresh: o.fresh === true,
    })
  }
  const tiers = (Array.isArray(r.tiers) ? r.tiers : []).flatMap((t: unknown) => {
    const o = (t ?? {}) as Record<string, unknown>
    return o.tier == null ? [] : [{ tier: tierOf(o.tier), points: Math.max(0, Math.round(num(o.points))) }]
  })
  const earned = items.filter(i => i.earnedAt).length
  return {
    total: Math.max(items.length, Math.round(num(r.total, items.length))),
    earned,
    newCount: Math.max(0, Math.round(num(r.new, items.filter(i => i.isNew).length))),
    tiers,
    items,
  }
}

// ── Слова ──────────────────────────────────────────────────────────────────

const w = (n: number, one: string, few: string, many: string) => plural(n, one, few, many)

interface CategoryMeta {
  title: string
  /** Подпись плитки в лестнице: «20 задач», «80+ баллов». */
  label: (n: number) => string
  /** Полное имя вне лестницы (тост, главная, учитель): «20 задач каталога». */
  name:  (n: number) => string
  /** «Как получить». */
  how:   (n: number) => string
}

const SPECIAL: Record<string, { name: string; how: (n: number) => string }> = {
  'special:flawless':    { name: 'Без ошибок', how: n => `${n} ${w(n, 'верный ответ', 'верных ответа', 'верных ответов')} подряд в каталоге с проверкой` },
  'special:marathon':    { name: 'Марафон', how: n => `${n} ${w(n, 'задача', 'задачи', 'задач')} каталога за один день` },
  'special:early':       { name: 'Ранняя пташка', how: () => 'Сдайте ДЗ за 3 дня до срока или раньше' },
  'special:all_numbers': { name: 'Все номера', how: () => 'Хотя бы одна верная задача каталога в каждом номере части 1' },
  'special:full_kim':    { name: 'Полный КИМ', how: n => `По ${n} ${w(n, 'верной задаче', 'верных задачи', 'верных задач')} каталога в каждом номере части 1` },
  'special:goal':        { name: 'Цель достигнута', how: () => 'Примерный балл ЕГЭ дошёл до вашей цели' },
}

const META: Record<Exclude<AchievementCategory, 'special'>, CategoryMeta> = {
  catalog: {
    title: 'Каталог: верно с проверкой',
    label: n => `${n} ${w(n, 'задача', 'задачи', 'задач')}`,
    name:  n => `${n} ${w(n, 'задача', 'задачи', 'задач')} каталога`,
    how:   n => `Решите верно ${n} ${w(n, 'задачу', 'задачи', 'задач')} каталога с проверкой ответа`,
  },
  hw: {
    title: 'Сданные ДЗ',
    label: n => `${n} ДЗ`,
    name:  n => `${n} ДЗ`,
    how:   n => `Сдайте ${n} ${w(n, 'домашнее задание', 'домашних задания', 'домашних заданий')}`,
  },
  ontime: {
    title: 'ДЗ вовремя',
    label: n => `${n} ДЗ`,
    name:  n => `${n} ДЗ вовремя`,
    how:   n => `Сдайте ${n} ДЗ до срока (без срока — тоже вовремя)`,
  },
  five: {
    title: 'Пятёрки за ДЗ',
    label: n => `${n} ${w(n, 'пятёрка', 'пятёрки', 'пятёрок')}`,
    name:  n => `${n} ${w(n, 'пятёрка', 'пятёрки', 'пятёрок')} за ДЗ`,
    how:   n => `Получите «5» за ДЗ ${n} ${w(n, 'раз', 'раза', 'раз')}`,
  },
  mock: {
    title: 'Пробники',
    label: n => `${n} ${w(n, 'пробник', 'пробника', 'пробников')}`,
    name:  n => `${n} ${w(n, 'пробник', 'пробника', 'пробников')}`,
    how:   n => `Напишите ${n} ${w(n, 'пробник', 'пробника', 'пробников')} — награда придёт, когда учитель внесёт баллы`,
  },
  mockscore: {
    title: 'Результат пробника',
    label: n => `${n}+ ${w(n, 'балл', 'балла', 'баллов')}`,
    name:  n => `Пробник на ${n}+`,
    how:   n => `Наберите на пробнике ЕГЭ ${n} и больше тестовых баллов`,
  },
  streak: {
    title: 'Серия дней с решением',
    label: n => `${n} ${w(n, 'день', 'дня', 'дней')}`,
    name:  n => `Серия ${n} ${w(n, 'день', 'дня', 'дней')}`,
    how:   n => `Решайте что-нибудь ${n} ${w(n, 'день', 'дня', 'дней')} подряд — каталог, ДЗ, тест или пробник`,
  },
  daily: {
    title: 'Задачи дня',
    label: n => `${n} ${w(n, 'задача дня', 'задачи дня', 'задач дня')}`,
    name:  n => `${n} ${w(n, 'задача дня', 'задачи дня', 'задач дня')}`,
    how:   n => `Решите ${n} ${w(n, 'задачу дня', 'задачи дня', 'задач дня')} — каждую в её день`,
  },
  weekly: {
    title: 'Цели недели',
    label: n => `${n} ${w(n, 'неделя', 'недели', 'недель')}`,
    name:  n => `${n} ${w(n, 'цель недели', 'цели недели', 'целей недели')}`,
    how:   n => `Выполните цель недели ${n} ${w(n, 'раз', 'раза', 'раз')}`,
  },
  confident: {
    title: 'Номера «уверенно»',
    label: n => `${n} ${w(n, 'номер', 'номера', 'номеров')}`,
    name:  n => `${n} ${w(n, 'номер', 'номера', 'номеров')} «уверенно»`,
    how:   n => `Доведите ${n} ${w(n, 'номер', 'номера', 'номеров')} части 1 до зоны «уверенно»`,
  },
  closed: {
    title: 'Закрыта зона роста',
    label: n => `${n} ${w(n, 'номер', 'номера', 'номеров')}`,
    name:  n => `${n} ${w(n, 'зона роста закрыта', 'зоны роста закрыты', 'зон роста закрыто')}`,
    how:   n => `Переведите ${n} ${w(n, 'номер', 'номера', 'номеров')} из «зоны роста» в «уверенно»`,
  },
  forecast: {
    title: 'Рост прогноза',
    label: n => `+${n} ${w(n, 'балл', 'балла', 'баллов')}`,
    name:  n => `Прогноз +${n}`,
    how:   n => `Поднимите примерный балл ЕГЭ на ${n} ${w(n, 'балл', 'балла', 'баллов')} от первого показа`,
  },
  tests: {
    title: 'Тесты тем',
    label: n => `${n} ${w(n, 'тест', 'теста', 'тестов')}`,
    name:  n => `${n} ${w(n, 'тест', 'теста', 'тестов')} тем`,
    how:   n => `Пройдите ${n} ${w(n, 'тест', 'теста', 'тестов')} тем`,
  },
  topics: {
    title: 'Пройденные темы',
    label: n => `${n} ${w(n, 'тема', 'темы', 'тем')}`,
    name:  n => `${n} ${w(n, 'тема', 'темы', 'тем')} курса`,
    how:   n => `Пройдите ${n} ${w(n, 'тему', 'темы', 'тем')} курса`,
  },
  redo: {
    title: 'Доработки',
    label: n => `${n} ${w(n, 'доработка', 'доработки', 'доработок')}`,
    name:  n => `${n} ${w(n, 'доработка', 'доработки', 'доработок')}`,
    how:   n => `Исправьте и пересдайте ${n} ${w(n, 'работу', 'работы', 'работ')}, которую вернули на доработку`,
  },
}

export function categoryTitle(c: AchievementCategory): string {
  return c === 'special' ? 'Особые' : META[c].title
}

type ItemRef = Pick<AchievementItem, 'key' | 'category' | 'threshold'>

/** Подпись плитки в лестнице. */
export function achievementLabel(i: ItemRef): string {
  return i.category === 'special' ? (SPECIAL[i.key]?.name ?? i.key) : META[i.category].label(i.threshold)
}

/** Полное имя: тост, главная, карточка учителя. */
export function achievementName(i: ItemRef): string {
  return i.category === 'special' ? (SPECIAL[i.key]?.name ?? i.key) : META[i.category].name(i.threshold)
}

/** Ключ «категория:порог» → имя (лента «Баллов школы» приносит только ключ). */
export function achievementNameByKey(key: string): string {
  if (SPECIAL[key]) return SPECIAL[key].name
  const [cat, t] = key.split(':')
  const n = Number(t)
  if (!isCategory(cat) || cat === 'special' || !Number.isFinite(n)) return key
  return META[cat].name(n)
}

export function pointsText(points: number): string {
  return points > 0 ? `+${points}` : 'значок'
}

/** Подсказка «как получить» (и за что дана, если получена). */
export function achievementHint(i: AchievementItem): string {
  const how = i.category === 'special' ? (SPECIAL[i.key]?.how(i.threshold) ?? '') : META[i.category].how(i.threshold)
  const reward = i.points > 0
    ? `+${i.points} ${w(i.points, 'балл', 'балла', 'баллов')} школы`
    : 'без баллов школы: прогноз считается на вашем устройстве'
  const state = i.earnedAt ? 'получено' : i.have > 0 && i.need > 1 ? `пока ${i.have} из ${i.need}` : null
  return [how, reward, state].filter(Boolean).join(' · ')
}

// ── Лестницы, ближайшие, фильтр ─────────────────────────────────────────────

export type TileState = 'earned' | 'current' | 'locked'

export interface TileView {
  item:  AchievementItem
  state: TileState
  /** Доля пути от прошлой ступени до этой (0..1) — у «current». */
  progress: number
  /** «23 из 50» у текущей, «получено» у полученной. */
  sub:   string
}

export interface Ladder {
  category: AchievementCategory
  title:    string
  tiles:    TileView[]
  got:      number
  count:    number
}

/**
 * Лестницы по категориям в порядке макета. В лестнице «текущая» — первая
 * неполученная ступень: прогресс от предыдущего порога («23 из 50», полоска
 * (23 − 20) / (50 − 20)). Особые — без «текущей»: каждая сама по себе.
 */
export function buildLadders(a: Pick<Achievements, 'items'>): Ladder[] {
  const out: Ladder[] = []
  for (const category of CATEGORY_ORDER) {
    const items = a.items.filter(i => i.category === category)
    if (items.length === 0) continue
    let curMarked = category === 'special'
    let prev = 0
    const tiles: TileView[] = items.map(item => {
      const earned = item.earnedAt != null
      let state: TileState = earned ? 'earned' : 'locked'
      let progress = 0
      let sub = earned ? 'получено' : ''
      if (!earned && !curMarked) {
        curMarked = true
        state = 'current'
        const base = Math.min(prev, item.need - 1)
        progress = Math.max(0, Math.min(1, (item.have - base) / Math.max(1, item.need - base)))
        sub = `${Math.min(item.have, item.need)} из ${item.need}`
      } else if (!earned && category === 'special') {
        // как в макете: у неполученной особой — «как получить»; начатая — «9 из 30»
        sub = item.have > 0 && item.need > 1
          ? `${Math.min(item.have, item.need)} из ${item.need}`
          : (SPECIAL[item.key]?.how(item.threshold) ?? '')
      }
      prev = item.need
      return { item, state, progress, sub }
    })
    out.push({ category, title: categoryTitle(category), tiles, got: tiles.filter(t => t.state === 'earned').length, count: tiles.length })
  }
  return out
}

export interface NearView extends TileView {
  title: string
  left:  number
}

/** «Ближайшие награды» — текущие ступени лестниц с наибольшей долей пути. */
export function nearest(ladders: readonly Ladder[], k = 4): NearView[] {
  return ladders
    .flatMap(l => l.tiles.filter(t => t.state === 'current').map(t => ({
      ...t, title: l.title, left: Math.max(0, t.item.need - t.item.have),
    })))
    .sort((x, y) => y.progress - x.progress || x.left - y.left || CATEGORY_ORDER.indexOf(x.item.category) - CATEGORY_ORDER.indexOf(y.item.category))
    .slice(0, k)
}

export type AchievementFilter = 'all' | 'done' | 'near' | AchievementCategory

/** Фильтр как в макете: «Полученные» — только полученные плитки, «Ближайшие» — только текущие; пустые категории прячутся. */
export function filterLadders(ladders: readonly Ladder[], f: AchievementFilter): Ladder[] {
  if (f === 'all') return [...ladders]
  if (f === 'done' || f === 'near') {
    const want: TileState = f === 'done' ? 'earned' : 'current'
    return ladders
      .map(l => ({ ...l, tiles: l.tiles.filter(t => t.state === want) }))
      .filter(l => l.tiles.length > 0)
  }
  return ladders.filter(l => l.category === f)
}

/** Последние полученные — для главной и учителя. */
export function latestEarned(a: Pick<Achievements, 'items'>, k = 3): AchievementItem[] {
  return a.items
    .filter(i => i.earnedAt)
    .sort((x, y) => Date.parse(y.earnedAt!) - Date.parse(x.earnedAt!) || y.tier - x.tier || y.threshold - x.threshold)
    .slice(0, k)
}

/** «Новая награда: 20 ДЗ · +25»; несколько — «Новые награды: …, … и ещё N». */
export function achievementToastText(fresh: readonly AchievementItem[]): string | null {
  if (fresh.length === 0) return null
  const sorted = [...fresh].sort((x, y) => y.points - x.points || y.tier - x.tier)
  const one = (i: AchievementItem) => (i.points > 0 ? `${achievementName(i)} · +${i.points}` : achievementName(i))
  if (sorted.length === 1) return `Новая награда: ${one(sorted[0])}`
  const shown = sorted.slice(0, 2).map(one).join(', ')
  const rest = sorted.length - 2
  return `Новые награды: ${shown}${rest > 0 ? ` и ещё ${rest}` : ''}`
}

/** Счётчики под уровнем: награды, задачи каталога, сданные ДЗ, рекорд серии — «have» из ответа базы. */
export function achievementStats(a: Achievements) {
  const have = (c: AchievementCategory) => Math.max(0, ...a.items.filter(i => i.category === c).map(i => i.have))
  return { earned: a.earned, total: a.total, catalog: have('catalog'), hw: have('hw'), streak: have('streak') }
}

// ── Учитель ──────────────────────────────────────────────────────────────

export interface StaffAchievements { total: number; earned: number; latest: string[] }

/** Ответ `student_achievements_for_staff` → «N из 79 · последние: …». */
export function normalizeStaffAchievements(raw: unknown): StaffAchievements | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const total = Number(r.total)
  if (!Number.isFinite(total) || total <= 0) return null
  const latest = (Array.isArray(r.latest) ? r.latest : []).flatMap((x: unknown) => {
    const o = (x ?? {}) as Record<string, unknown>
    if (typeof o.key !== 'string' || !isCategory(o.category)) return []
    return [achievementName({ key: o.key, category: o.category, threshold: Number(o.threshold) || 0 })]
  })
  return { total, earned: Math.max(0, Number(r.earned) || 0), latest }
}
