export interface StudentNumberStatRow {
  section_id: string
  exam_number: number | null
  section_title: string
  subject: string
  exam_type: string
  solved_count: number
  fully_correct_count: number
  partial_count: number
  wrong_count: number
  earned_points: number
  max_points: number
  success_ratio: number | null
  last_solved_at: string | null
}

export type NumberTrafficLight = 'green' | 'yellow' | 'red' | 'gray'

export interface NumberRecommendation {
  kind: 'repeat' | 'support' | 'strong'
  title: string
  description: string
}

export function getNumberTrafficLight(row: StudentNumberStatRow): NumberTrafficLight {
  const ratio = row.success_ratio ?? 0
  if (row.solved_count < 5) return 'gray'
  if (ratio >= 80) return 'green'
  if (ratio >= 50) return 'yellow'
  return 'red'
}

export function getNumberRecommendation(row: StudentNumberStatRow): NumberRecommendation | null {
  const ratio = row.success_ratio ?? 0
  const label = row.exam_number !== null ? `№${row.exam_number}` : row.section_title

  if (row.solved_count >= 5 && ratio < 50) {
    return {
      kind: 'repeat',
      title: `Повторить ${label}`,
      description: `Решено ${row.solved_count}, доля верных ${formatRatio(ratio)}.`,
    }
  }

  if (row.solved_count >= 2 && row.solved_count < 5 && ratio < 60) {
    return {
      kind: 'support',
      title: `Закрепить ${label}`,
      description: `Пока мало попыток: ${row.solved_count}, доля верных ${formatRatio(ratio)}.`,
    }
  }

  if (row.solved_count >= 5 && ratio >= 80) {
    return {
      kind: 'strong',
      title: `Сильный номер ${label}`,
      description: `Решено ${row.solved_count}, доля верных ${formatRatio(ratio)}.`,
    }
  }

  return null
}

export function formatRatio(ratio: number | null) {
  if (ratio === null || Number.isNaN(ratio)) return '—'
  return `${ratio.toFixed(1)}%`
}
