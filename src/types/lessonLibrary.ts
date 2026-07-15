export type LessonTemplateSubject = 'physics' | 'math'
export type LessonTemplateExam = 'ege' | 'oge' | null
export type LessonTemplateMaterialType = 'notes' | 'theory' | 'tasks' | 'homework' | 'solution' | 'video' | 'link'

export interface LessonTemplate {
  id: string
  owner_id: string
  title: string
  subject: LessonTemplateSubject
  exam_type: LessonTemplateExam
  description: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
}

export interface LessonTemplateMaterial {
  id?: string
  template_id: string
  type: LessonTemplateMaterialType
  content: string | null
  file_path: string | null
  link_url: string | null
  sort_order: number
  link_meta?: {
    path: string
    title: string
    url: string
  } | null
}

export interface LessonTemplateTask {
  id: string
  template_id: string
  task_kind: 'homework_template'
  catalog_task_id: string | null
  title: string | null
  payload: Record<string, unknown>
  sort_order: number
  created_at: string
}

export interface LessonTemplateWithDetails extends LessonTemplate {
  materials: LessonTemplateMaterial[]
  tasks: LessonTemplateTask[]
}
