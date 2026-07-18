import applyLogCsv from '../../reports/physics-ege/apply-log.csv?raw'

export type PhysicsDifficulty = 'лёгкая' | 'средняя' | 'сложная'

const DIFFICULTY_ORDER: Record<PhysicsDifficulty, number> = {
  'лёгкая': 0,
  'средняя': 1,
  'сложная': 2,
}

function normalizeDifficulty(raw: string): PhysicsDifficulty | null {
  const value = raw.trim().replace(/^"+|"+$/g, '')
  if (value === 'лёгкая' || value === 'средняя' || value === 'сложная') return value
  return null
}

function parseDifficultyMap(csv: string): Record<number, PhysicsDifficulty> {
  const map: Record<number, PhysicsDifficulty> = {}
  const lines = csv.split(/\r?\n/).slice(1)
  for (const line of lines) {
    if (!line.trim()) continue
    const cells = line.split('","').map((cell, index, arr) => {
      if (index === 0) return cell.replace(/^"/, '')
      if (index === arr.length - 1) return cell.replace(/"$/, '')
      return cell
    })
    if (cells.length < 6) continue
    const externalId = Number(cells[0])
    const difficulty = normalizeDifficulty(cells[5] ?? '')
    if (!Number.isFinite(externalId) || !difficulty) continue
    map[externalId] = difficulty
  }
  return map
}

export const physicsDifficultyByExternalId = parseDifficultyMap(applyLogCsv)

export function getPhysicsDifficultyOrder(difficulty: string | null | undefined): number {
  if (!difficulty) return Number.MAX_SAFE_INTEGER
  return DIFFICULTY_ORDER[difficulty as PhysicsDifficulty] ?? Number.MAX_SAFE_INTEGER
}
