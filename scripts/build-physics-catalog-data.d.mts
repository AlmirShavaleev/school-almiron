// Типы для `build-physics-catalog-data.mjs` (§253) — его чистые функции гоняет
// `src/lib/__tests__/physicsCatalogData.test.ts`, а `tsc -b` проверяет тест.
export type PhysicsDifficultyValue = 'лёгкая' | 'средняя' | 'сложная'
export interface PhysicsTopicRow { id: string; external_id: number; title: string }

export const APPLY_LOG_PATH: string
export const DRY_RUN_PREVIEW_PATH: string
export const DIFFICULTY_DATA_PATH: string
export const TOPICS_DATA_PATH: string

export function normalizeDifficulty(raw: string): PhysicsDifficultyValue | null
export function parseDifficultyMap(csv: string): Record<number, PhysicsDifficultyValue>
export function parsePhysicsTopicsCatalog(raw: string): PhysicsTopicRow[]
export function serializeDifficultyMap(map: Record<number, string>): string
export function serializeTopicsCatalog(items: PhysicsTopicRow[]): string
export function buildPhysicsCatalogData(): {
  difficultyMap: Record<number, PhysicsDifficultyValue>
  topics: PhysicsTopicRow[]
  difficulty: string
  topicsText: string
}
