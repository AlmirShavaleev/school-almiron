// §253. Список тем собран скриптом `scripts/build-physics-catalog-data.mjs` из
// `reports/physics-ege/dry-run-preview.json` (там же правила разбора). Сам отчёт
// (551 КБ) в клиентскую сборку не идёт: обновили отчёт — `npm run build:physics-data`.
import topicsData from './physicsTopicsCatalog.data.json'

export interface PhysicsTopicCatalogItem {
  id: string
  external_id: number
  title: string
}

export const physicsTopicsCatalog: PhysicsTopicCatalogItem[] = topicsData
