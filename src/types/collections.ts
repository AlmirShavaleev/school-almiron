export type WorkType =
  | 'homework'
  | 'classwork'
  | 'control'
  | 'worksheet'
  | 'ege_variant'
  | 'oge_variant'
  | 'custom'

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  homework:    'Домашняя работа',
  classwork:   'Классная работа',
  control:     'Контрольная работа',
  worksheet:   'Рабочий лист',
  ege_variant: 'Вариант ЕГЭ',
  oge_variant: 'Вариант ОГЭ',
  custom:      'Подборка задач',
}

export type Subject = 'Математика' | 'Физика'

export interface TaskCollection {
  id:          string
  created_by:  string
  title:       string
  description: string | null
  subject:     Subject
  work_type:   WorkType
  pdf_config:  Record<string, unknown>
  created_at:  string
  updated_at:  string
  is_archived: boolean
}

export interface TaskCollectionItem {
  id:              string
  collection_id:   string
  catalog_task_id: string
  position:        number
  custom_number:   string | null
  created_at:      string
}

/** Input for save_collection_atomic RPC */
export interface CollectionItemInput {
  catalog_task_id: string
  position:        number
  custom_number:   string | null
}

/** Minimal cart entry — just the task id, no variant */
export interface CartItem {
  catalog_task_id: string
  added_at:        number
}
