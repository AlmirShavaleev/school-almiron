// §253. Карта сложностей собрана скриптом `scripts/build-physics-catalog-data.mjs` из
// `reports/physics-ege/apply-log.csv` (там же правила разбора). Сам отчёт (579 КБ)
// в клиентскую сборку не идёт: обновили отчёт — `npm run build:physics-data`.
import difficultyData from './physicsDifficulty.data.json'

export type PhysicsDifficulty = 'лёгкая' | 'средняя' | 'сложная'

const DIFFICULTY_ORDER: Record<PhysicsDifficulty, number> = {
  'лёгкая': 0,
  'средняя': 1,
  'сложная': 2,
}

export const physicsDifficultyByExternalId = difficultyData as Record<number, PhysicsDifficulty>

export function getPhysicsDifficultyOrder(difficulty: string | null | undefined): number {
  if (!difficulty) return Number.MAX_SAFE_INTEGER
  return DIFFICULTY_ORDER[difficulty as PhysicsDifficulty] ?? Number.MAX_SAFE_INTEGER
}
