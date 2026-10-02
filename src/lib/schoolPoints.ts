/**
 * §255. «Баллы школы» — разбор ответа `student_school_points()`.
 *
 * Баллы НЕ записываются в таблицы: база считает их из истории (ДЗ, оценки,
 * каталог, пробники, серия заходов) одной definer-функцией от auth.uid().
 * ПРАВИЛА (сколько за что) и пороги уровней живут ОДНОЙ таблицей констант в
 * начале этой функции (миграция 20261002153407_exam_forecast_evidence_and_school_points) и приходят в ответе (`rules`,
 * `levels`, `need` у значков) — у клиента своих копий чисел нет, поэтому
 * владелец меняет правило в одном месте.
 *
 * Здесь — только тексты: лента «за что» и полоса до следующего уровня.
 *
 * §257: пять значков §255 сняты — их место заняли награды «Достижений»
 * (`achievements.ts`, одна таблица правил в базе). Баллы полученных наград
 * база добавляет в сумму сама (`achievement` в ленте, ключ награды — в title);
 * уровней 20.
 */
import { plural } from '@/lib/plural'
import { normalizeCatalogRules, type CatalogRules } from '@/lib/catalogRewards'
import { achievementNameByKey } from '@/lib/achievements'

/**
 * §256: каталог — только задачи с ПРОВЕРЕННЫМ ответом, награда по зоне номера
 * (+5/+3/+1) и вехи 10/20/30 (`catalog_milestone`), задача дня (`daily`), цель
 * недели (`weekly`); задачи вариантов и к уроку — отдельной строкой (`variant`).
 * Самоотметки «Выполнено» баллов не дают. Серия — дни с решением.
 */
export type FeedKind =
  | 'hw_ontime' | 'hw_late' | 'hw_grade' | 'catalog' | 'catalog_milestone' | 'daily' | 'weekly' | 'variant' | 'mock' | 'streak'
  | 'achievement'

export interface FeedItem {
  kind:   FeedKind
  at:     string
  points: number
  title:  string | null
  n:      number | null
}

export interface PointsRules {
  hw_ontime:  number
  hw_late:    number
  grade5:     number
  grade4:     number
  accepted:   number
  /** Задача варианта / к уроку (§256; до миграции §256 (20261002174213…174501) база звала это `catalog`). */
  variant:    number
  mock_point: number
  streak_day: number
}

export interface SchoolPoints {
  total: number
  level: { n: number; name: string; from: number; next: number | null; nextName: string | null }
  rules: PointsRules
  /** §256: правила каталога (зоны, вехи, задача дня, цель недели); null — база старая. */
  catalogRules: CatalogRules | null
  feed:  FeedItem[]
  /** §257: из суммы — баллы полученных наград (0 — база до §257). */
  achievementPoints: number
}

const KINDS: readonly FeedKind[] = ['hw_ontime', 'hw_late', 'hw_grade', 'catalog', 'catalog_milestone', 'daily', 'weekly', 'variant', 'mock', 'streak', 'achievement']
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const numOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null)

export function normalizeSchoolPoints(raw: unknown): SchoolPoints | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.total == null) return null
  const lv = (r.level ?? {}) as Record<string, unknown>
  const ru = (r.rules ?? {}) as Record<string, unknown>
  const rules: PointsRules = {
    hw_ontime: num(ru.hw_ontime), hw_late: num(ru.hw_late), grade5: num(ru.grade5), grade4: num(ru.grade4),
    accepted: num(ru.accepted), variant: num(ru.variant ?? ru.catalog), mock_point: num(ru.mock_point), streak_day: num(ru.streak_day),
  }
  const feed: FeedItem[] = []
  for (const item of Array.isArray(r.feed) ? r.feed : []) {
    const x = (item ?? {}) as Record<string, unknown>
    if (!KINDS.includes(x.kind as FeedKind) || typeof x.at !== 'string') continue
    const points = num(x.points)
    if (points <= 0) continue
    feed.push({ kind: x.kind as FeedKind, at: x.at, points, title: typeof x.title === 'string' ? x.title : null, n: numOrNull(x.n) })
  }
  return {
    total: Math.max(0, Math.round(num(r.total))),
    level: {
      n: Math.max(1, num(lv.n, 1)),
      name: typeof lv.name === 'string' ? lv.name : '',
      from: num(lv.from),
      next: numOrNull(lv.next),
      nextName: typeof lv.next_name === 'string' ? lv.next_name : null,
    },
    rules,
    catalogRules: normalizeCatalogRules(r.catalog_rules),
    feed,
    achievementPoints: Math.max(0, Math.round(num(r.achievement_points))),
  }
}

const q = (t: string | null) => (t ? `«${t}»` : '')

/** Строка ленты: «ДЗ «Динамика» сдано вовремя», «3 задачи из каталога решены». */
export function feedText(f: FeedItem): string {
  switch (f.kind) {
    case 'hw_ontime': return `ДЗ ${q(f.title)} сдано вовремя`.replace('  ', ' ')
    case 'hw_late':   return `ДЗ ${q(f.title)} сдано после срока`.replace('  ', ' ')
    case 'hw_grade':  return f.n != null ? `ДЗ ${q(f.title)} принято — ${f.n}` : `ДЗ ${q(f.title)} принято`
    case 'catalog': {
      const n = f.n ?? 1
      return `${n} ${plural(n, 'задача', 'задачи', 'задач')} из каталога ${plural(n, 'решена', 'решены', 'решены')}`
    }
    case 'catalog_milestone': {
      const n = f.n ?? 10
      return `${n} задач каталога по номеру — веха`
    }
    case 'daily': return f.n != null ? `Задача дня решена (№${f.n})` : 'Задача дня решена'
    case 'weekly': return 'Цель недели выполнена'
    case 'variant': {
      const n = f.n ?? 1
      return `${n} ${plural(n, 'задача', 'задачи', 'задач')} к уроку и в вариантах ${plural(n, 'решена', 'решены', 'решены')}`
    }
    case 'mock': {
      const n = f.n ?? f.points
      const head = f.title && /^пробник/i.test(f.title) ? q(f.title) : `Пробник ${q(f.title)}`.trim()
      return `${head} — ${n} ${plural(n, 'первичный балл', 'первичных балла', 'первичных баллов')}`
    }
    case 'streak': {
      const n = f.n ?? 2
      return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
    }
    case 'achievement': return f.title ? `Награда «${achievementNameByKey(f.title)}»` : 'Награда'
  }
}

export interface LevelProgress {
  /** Доля пути до следующего уровня 0..1 (на последнем уровне — 1). */
  ratio: number
  /** «до 5-го уровня — 60 баллов» / «высший уровень». */
  text:  string
  /** §257, «Достижения»: «до уровня 5 «Система» — 110 баллов». */
  long:  string
}

export function levelProgress(p: Pick<SchoolPoints, 'total' | 'level'>): LevelProgress {
  const { next, from, n, nextName } = p.level
  if (next == null || next <= from) return { ratio: 1, text: 'высший уровень', long: 'высший уровень — дальше только награды' }
  const left = Math.max(0, next - p.total)
  const pts = `${left} ${plural(left, 'балл', 'балла', 'баллов')}`
  return {
    ratio: Math.min(1, Math.max(0, (p.total - from) / (next - from))),
    text: `до ${n + 1}-го уровня — ${pts}`,
    long: `до уровня ${n + 1}${nextName ? ` «${nextName}»` : ''} — ${pts}`,
  }
}

/** «Как получить баллы» — из правил ответа базы, без своих чисел. */
export function rulesText(r: PointsRules, c: CatalogRules | null = null): string[] {
  const out = [
    `ДЗ сдано вовремя +${r.hw_ontime}, после срока +${r.hw_late}`,
    `ДЗ принято на 5 +${r.grade5}, на 4 +${r.grade4}, без оценки +${r.accepted}`,
  ]
  if (c) {
    const per = c.zones.map(z => `+${z.perTask}`).join(' / ')
    const ats = c.zones[0]?.milestones.map(m => m.at).join('/') ?? ''
    out.push(`Задача каталога с проверкой ответа ${per} — больше за номер, который пока не получается; бонусы за ${ats} верных`)
    out.push(`Задача дня +${c.dailyTask}, цель недели +${c.weeklyGoal}`)
  }
  out.push(`Задача к уроку или в варианте +${r.variant}`)
  out.push(`Пробник: +${r.mock_point} за первичный балл`)
  out.push(`День серии (решали хоть что-то) со второго подряд +${r.streak_day}`)
  out.push('Награды «Достижений»: бронза, серебро, золото, легенда — баллы на странице «Достижения»')
  return out
}
