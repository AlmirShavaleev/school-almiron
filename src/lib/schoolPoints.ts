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
 * Здесь — только тексты: лента «за что», подсказки значков «как получить»,
 * полоса до следующего уровня. Единственный значок, который считает клиент, —
 * «Прогноз +5»: прогноз балла живёт на клиенте (`egeForecast.ts`).
 */
import { plural } from '@/lib/plural'

export type FeedKind = 'hw_ontime' | 'hw_late' | 'hw_grade' | 'catalog' | 'mock' | 'streak'

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
  catalog:    number
  mock_point: number
  streak_day: number
}

export interface SchoolPoints {
  total: number
  level: { n: number; name: string; from: number; next: number | null; nextName: string | null }
  rules: PointsRules
  feed:  FeedItem[]
  /** Значки из базы: ключ, сколько есть, сколько нужно. */
  badges: { key: string; have: number; need: number }[]
}

/** Сколько должен вырасти прогноз за 30 дней ради значка «Прогноз +5». */
export const FORECAST_BADGE_DELTA = 5

const KINDS: readonly FeedKind[] = ['hw_ontime', 'hw_late', 'hw_grade', 'catalog', 'mock', 'streak']
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
    accepted: num(ru.accepted), catalog: num(ru.catalog), mock_point: num(ru.mock_point), streak_day: num(ru.streak_day),
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
    feed,
    badges: (Array.isArray(r.badges) ? r.badges : []).flatMap((item: unknown) => {
      const x = (item ?? {}) as Record<string, unknown>
      return typeof x.key === 'string' ? [{ key: x.key, have: num(x.have), need: Math.max(1, num(x.need, 1)) }] : []
    }),
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
    case 'mock': {
      const n = f.n ?? f.points
      const head = f.title && /^пробник/i.test(f.title) ? q(f.title) : `Пробник ${q(f.title)}`.trim()
      return `${head} — ${n} ${plural(n, 'первичный балл', 'первичных балла', 'первичных баллов')}`
    }
    case 'streak': {
      const n = f.n ?? 2
      return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
    }
  }
}

export interface LevelProgress {
  /** Доля пути до следующего уровня 0..1 (на последнем уровне — 1). */
  ratio: number
  /** «до 5-го уровня — 60 баллов» / «высший уровень». */
  text:  string
}

export function levelProgress(p: Pick<SchoolPoints, 'total' | 'level'>): LevelProgress {
  const { next, from, n } = p.level
  if (next == null || next <= from) return { ratio: 1, text: 'высший уровень' }
  const left = Math.max(0, next - p.total)
  return {
    ratio: Math.min(1, Math.max(0, (p.total - from) / (next - from))),
    text: `до ${n + 1}-го уровня — ${left} ${plural(left, 'балл', 'балла', 'баллов')}`,
  }
}

export interface BadgeView {
  key:   string
  title: string
  got:   boolean
  /** Подсказка: получен — за что; ещё нет — как получить и сколько осталось. */
  hint:  string
}

/**
 * Пять значков в порядке макета. `forecastDelta` — лучший «+N за месяц» по
 * предметам ученика (null — прогноза нет ни по одному).
 */
export function buildBadges(p: Pick<SchoolPoints, 'badges'>, forecastDelta: number | null): BadgeView[] {
  const b = (key: string) => p.badges.find(x => x.key === key)
  const streak = b('streak7'), ontime = b('ontime10'), mock = b('mock1'), cat = b('catalog100')
  const tasks = (n: number) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`
  const out: BadgeView[] = []
  {
    const need = streak?.need ?? 7, have = streak?.have ?? 0, got = have >= need
    out.push({ key: 'streak7', title: 'Неделя без пропусков', got,
      hint: got ? `Заходили ${need} ${plural(need, 'день', 'дня', 'дней')} подряд` : `Заходите ${need} ${plural(need, 'день', 'дня', 'дней')} подряд · рекорд пока ${have}` })
  }
  {
    const need = ontime?.need ?? 10, have = ontime?.have ?? 0, got = have >= need
    out.push({ key: 'ontime10', title: `${need} ДЗ вовремя`, got,
      hint: got ? `Сдано вовремя: ${have}` : `Сдайте ${need} ДЗ до срока · пока ${have}` })
  }
  {
    const got = forecastDelta != null && forecastDelta >= FORECAST_BADGE_DELTA
    out.push({ key: 'forecast5', title: `Прогноз +${FORECAST_BADGE_DELTA}`, got,
      hint: got
        ? `Примерный балл вырос на ${forecastDelta} за месяц`
        : `Поднимите примерный балл на ${FORECAST_BADGE_DELTA} за 30 дней${forecastDelta != null ? ` · сейчас ${forecastDelta > 0 ? '+' : ''}${forecastDelta}` : ''}` })
  }
  {
    const need = mock?.need ?? 1, have = mock?.have ?? 0, got = have >= need
    out.push({ key: 'mock1', title: 'Первый пробник', got,
      hint: got ? 'Пробник написан и проверен' : 'Напишите пробник — значок появится, когда учитель внесёт баллы' })
  }
  {
    const need = cat?.need ?? 100, have = cat?.have ?? 0, got = have >= need
    out.push({ key: 'catalog100', title: `${need} задач каталога`, got,
      hint: got ? `Решено в каталоге: ${tasks(have)}` : `Решите ${tasks(need)} в каталоге · пока ${have}` })
  }
  return out
}

/** «Как получить баллы» — из правил ответа базы, без своих чисел. */
export function rulesText(r: PointsRules): string[] {
  return [
    `ДЗ сдано вовремя +${r.hw_ontime}, после срока +${r.hw_late}`,
    `ДЗ принято на 5 +${r.grade5}, на 4 +${r.grade4}, без оценки +${r.accepted}`,
    `Задача каталога +${r.catalog}`,
    `Пробник: +${r.mock_point} за первичный балл`,
    `День серии со второго подряд +${r.streak_day}`,
  ]
}
