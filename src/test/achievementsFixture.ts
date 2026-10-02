/**
 * §257. Выдуманный ответ `student_achievements_sync()` для тестов клиента.
 * Пороги и уровни — копия таблицы `achievement_rules()` из миграции §257 (20261002194006, 20261002194103)
 * (ТОЛЬКО как данные теста: клиент своих порогов не держит и берёт их из
 * ответа). Уровень — по месту в лестнице, как в базе.
 */
export const RULE_STEPS: Record<string, number[]> = {
  catalog: [1, 5, 10, 20, 50, 100, 200, 500, 1000],
  hw: [1, 5, 10, 20, 30, 50, 75, 100],
  ontime: [1, 5, 10, 25, 50],
  five: [1, 5, 10, 25],
  mock: [1, 3, 5, 10],
  mockscore: [27, 60, 70, 80, 90],
  streak: [3, 7, 14, 30, 60, 100],
  daily: [1, 7, 30, 100],
  weekly: [1, 4, 10, 20],
  confident: [1, 3, 6, 9, 12],
  closed: [1, 3, 5],
  forecast: [5, 10, 20, 30],
  tests: [1, 10, 25, 50],
  topics: [1, 10, 25, 50, 100],
  redo: [1, 5, 10],
}
export const SPECIAL_KEYS: [string, number][] = [
  ['special:flawless', 10], ['special:marathon', 30], ['special:early', 1],
  ['special:all_numbers', 1], ['special:full_kim', 10], ['special:goal', 1],
]
const TIER_POINTS = [0, 10, 25, 50, 100]
const tierAt = (i: number, len: number) => {
  const r = i / Math.max(len - 1, 1)
  return r < 0.34 ? 1 : r < 0.67 ? 2 : r < 0.95 ? 3 : 4
}

export interface SyncOpts {
  /** have по категории (особые — по ключу). */
  have?: Record<string, number>
  /** Полученные сверх «have ≥ need» (награда не отнимается). */
  keep?: string[]
  fresh?: string[]
  isNew?: string[]
  /** Момент получения: по умолчанию — порядок ключа (позже = выше порог). */
  earnedAt?: Record<string, string>
}

export function syncResponse(o: SyncOpts = {}) {
  const have = o.have ?? {}
  const items: Record<string, unknown>[] = []
  let k = 0
  const at = (key: string) => o.earnedAt?.[key] ?? new Date(Date.UTC(2026, 8, 1) + (k++) * 3_600_000).toISOString()
  for (const [category, steps] of Object.entries(RULE_STEPS)) {
    steps.forEach((t, i) => {
      const key = `${category}:${t}`
      const tier = tierAt(i, steps.length)
      const h = have[category] ?? 0
      const earned = h >= t || (o.keep ?? []).includes(key)
      items.push({
        key, category, threshold: t, tier, points: category === 'forecast' ? 0 : TIER_POINTS[tier],
        have: h, need: t, earned_at: earned ? at(key) : null,
        is_new: earned && (o.isNew ?? []).includes(key), fresh: earned && (o.fresh ?? []).includes(key),
      })
    })
  }
  for (const [key, t] of SPECIAL_KEYS) {
    const need = key === 'special:all_numbers' || key === 'special:full_kim' ? 12 : t
    const h = have[key] ?? 0
    const earned = h >= need || (o.keep ?? []).includes(key)
    items.push({
      key, category: 'special', threshold: t, tier: 3, points: key === 'special:goal' ? 0 : 50,
      have: h, need, earned_at: earned ? at(key) : null,
      is_new: earned && (o.isNew ?? []).includes(key), fresh: earned && (o.fresh ?? []).includes(key),
    })
  }
  const earned = items.filter(i => i.earned_at).length
  return {
    total: items.length,
    earned,
    new: items.filter(i => i.is_new).length,
    tiers: [{ tier: 1, points: 10 }, { tier: 2, points: 25 }, { tier: 3, points: 50 }, { tier: 4, points: 100 }],
    items,
  }
}
