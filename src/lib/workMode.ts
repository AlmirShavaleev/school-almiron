/**
 * §263. Режим работы ученика: пока у него идёт работа по времени (проверочная /
 * контрольная §240, окно — личное, если есть) или пробник (§221) и он её не
 * сдал, сайт для него закрыт — кроме страницы работы и сообщений учителю
 * (плавающая кнопка «Помощь» живёт поверх любой страницы и не закрывается).
 *
 * Определение «идёт работа» ОДНО — в базе (`student_active_works`); клиент
 * берёт его из `my_work_mode()` и только показывает. То же правило закрывает
 * каталог, материалы и ответы на сервере — клиентский замок здесь UX, а не
 * защита.
 *
 * Чистые помощники без сети.
 */
import { formatMoscowTime } from './timedWork'

export interface WorkMode {
  active: true
  kind: 'timed' | 'mock'
  workKind: 'check' | 'control' | 'mock'
  homeworkId: string | null
  mockExamId: string | null
  topicId: string | null
  courseId: string | null
  groupId: string | null
  title: string
  opensAt: string | null
  closesAt: string
  personal: boolean
  serverNow: string
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** Ответ `my_work_mode()` → режим или null (работы нет / ответ не тот). */
export function parseWorkMode(raw: unknown): WorkMode | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.active !== true) return null
  const closesAt = str(r.closes_at)
  const kind = r.kind === 'mock' ? 'mock' : r.kind === 'timed' ? 'timed' : null
  if (!closesAt || !kind) return null
  const homeworkId = str(r.homework_id)
  const mockExamId = str(r.mock_exam_id)
  if (kind === 'timed' && !(homeworkId && str(r.topic_id))) return null
  if (kind === 'mock' && !mockExamId) return null
  return {
    active: true,
    kind,
    workKind: r.work_kind === 'check' ? 'check' : r.work_kind === 'control' ? 'control' : 'mock',
    homeworkId,
    mockExamId,
    topicId: str(r.topic_id),
    courseId: str(r.course_id),
    groupId: str(r.group_id),
    title: str(r.title) ?? 'Работа',
    opensAt: str(r.opens_at),
    closesAt,
    personal: r.personal === true,
    serverNow: str(r.server_now) ?? new Date().toISOString(),
  }
}

/** Страница работы — куда ведёт «Вернуться к работе». */
export function workPath(w: WorkMode): string {
  if (w.kind === 'mock') return w.groupId ? `/my-course/${w.groupId}/mock/${w.mockExamId}` : '/my-mock-exams'
  return w.groupId ? `/my-course/${w.groupId}/topic/${w.topicId}` : '/my-course'
}

/**
 * Открыта ли страница во время работы: только страница САМОЙ работы (тема
 * работы по времени — с любым groupId в адресе; пробник — его страница).
 * Всё остальное — «<Раздел> закрыт до HH:MM».
 */
export function workModeAllows(pathname: string, w: WorkMode): boolean {
  const path = pathname.replace(/\/+$/, '')
  if (w.kind === 'timed' && w.topicId) {
    return new RegExp(`^/my-course/[^/]+/topic/${escapeRe(w.topicId)}$`).test(path)
  }
  if (w.kind === 'mock' && w.mockExamId) {
    return new RegExp(`^/my-course/[^/]+/mock/${escapeRe(w.mockExamId)}$`).test(path)
  }
  return false
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** «Идёт проверочная» / «Идёт контрольная» / «Идёт пробник». */
export function workHeadline(w: Pick<WorkMode, 'workKind'>): string {
  return w.workKind === 'check' ? 'Идёт проверочная' : w.workKind === 'control' ? 'Идёт контрольная' : 'Идёт пробник'
}

/** «проверочной» / «контрольной» / «пробника» — для «Во время …». */
export function workGenitive(w: Pick<WorkMode, 'workKind'>): string {
  return w.workKind === 'check' ? 'проверочной' : w.workKind === 'control' ? 'контрольной' : 'пробника'
}

/**
 * Род названия раздела → «закрыт / закрыта / закрыты». Названия — из шапки
 * (`PAGE_TITLES` в DashboardLayout). Неизвестное — мужской род («Раздел закрыт»).
 */
const FEMININE = new Set(['Главная', 'Проверка ДЗ', 'Статистика по номерам', 'Подборка', 'Панель группы', 'Программа курса', 'Библиотека уроков', 'Автосборка теста'])
const PLURAL = new Set(['Достижения', 'Домашние задания', 'Тренировочные варианты', 'Пробники', 'Уведомления', 'Настройки', 'Тесты', 'Занятия', 'Мои подборки', 'Ученики', 'Группы', 'Шаблоны ДЗ', 'Шаблоны пробников'])

export function closedTitle(section: string | null | undefined, w: Pick<WorkMode, 'closesAt'>): string {
  const name = section && section.trim() ? section.trim() : 'Раздел'
  const verb = FEMININE.has(name) ? 'закрыта' : PLURAL.has(name) ? 'закрыты' : 'закрыт'
  return `${name} ${verb} до ${formatMoscowTime(w.closesAt)}`
}

/** Когда перечитывать режим: раз в минуту, плюс ровно в момент конца окна. */
export const WORK_MODE_POLL_MS = 60_000
export function msUntilEnd(w: Pick<WorkMode, 'closesAt'>, serverNowMs: number): number {
  return Math.max(0, Date.parse(w.closesAt) - serverNowMs)
}
