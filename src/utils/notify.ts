/**
 * Утилита для создания in-app уведомлений.
 * После каждого in-app события ставит задачу в notification_queue для Telegram.
 * Отправка Telegram выполняется только серверной Edge Function (process-notification-queue).
 */
import { supabase } from '@/lib/supabase'
import type { Json, TablesInsert } from '@/types/database'

type NotifType = 'info' | 'success' | 'warning' | 'error'

interface NotifPayload {
  user_id: string
  title:   string
  message?: string
  type:    NotifType
}

interface QueueEntry {
  profile_id:        string
  channel:           'telegram'
  event_type:        string
  entity_type?:      string
  entity_id?:        string
  deduplication_key: string
  payload:           Json
}

async function send(payloads: NotifPayload[]) {
  if (payloads.length === 0) return
  // notifications.message обязателен в типах Insert; payload его всегда содержит
  await supabase.from('notifications').insert(payloads as TablesInsert<'notifications'>[])
}

/** Ставит уведомление в очередь для Telegram (ignores errors, in-app is primary) */
async function enqueue(entries: QueueEntry[]) {
  if (entries.length === 0) return
  // Вставляем по одному, чтобы unique-конфликт одной записи не сломал остальные
  await Promise.allSettled(
    entries.map(e => {
      const row: TablesInsert<'notification_queue'> = {
        ...e,
        status:        'pending',
        scheduled_for: new Date().toISOString(),
      }
      return supabase.from('notification_queue').insert(row)
    })
  )
}

/** Новое ДЗ: уведомить всех студентов группы */
export async function notifyNewHomework(
  groupId:     string,
  hwTitle:     string,
  dueDate:     string,
  hwId?:       string,
  courseTitle?: string,
) {
  const { data: members } = await supabase
    .from('group_students')
    .select('student_id, students(profile_id)')
    .eq('group_id', groupId)

  const profiles = (members || [])
    .map((m: any) => m.students?.profile_id as string)
    .filter(Boolean)

  await send(
    profiles.map(pid => ({
      user_id: pid,
      title:   '📚 Новое домашнее задание',
      message: `«${hwTitle}» — срок сдачи ${dueDate}`,
      type:    'info' as NotifType,
    }))
  )

  if (hwId) {
    await enqueue(
      profiles.map(pid => ({
        profile_id:        pid,
        channel:           'telegram' as const,
        event_type:        'new_homework',
        entity_type:       'homework',
        entity_id:         hwId,
        deduplication_key: `new_homework:${hwId}:${pid}`,
        payload: {
          title:        hwTitle,
          due_date:     dueDate,
          course_title: courseTitle ?? '',
          entity_id:    hwId,
        },
      }))
    )
  }
}

/** ДЗ проверено / отправлено на доработку */
export async function notifyHomeworkChecked(
  profileId: string,
  hwTitle:   string,
  status:    'checked' | 'revision',
  score?:    number | null,
  maxScore?: number,
  hwId?:     string,
  feedback?: string | null,
) {
  const isChecked = status === 'checked'
  await send([{
    user_id: profileId,
    title:   isChecked ? '✅ ДЗ проверено' : '🔄 ДЗ на доработку',
    message: isChecked
      ? `«${hwTitle}»${score != null ? ` — ${score}/${maxScore} б.` : ''}`
      : `«${hwTitle}» — учитель отправил на доработку`,
    type: isChecked ? 'success' : 'warning',
  }])

  if (hwId) {
    await enqueue([{
      profile_id:        profileId,
      channel:           'telegram',
      event_type:        'homework_reviewed',
      entity_type:       'homework',
      entity_id:         hwId,
      // key включает hwId + profileId (не submission_id, чтобы не дублировать при повторных проверках)
      deduplication_key: `homework_reviewed:${hwId}:${profileId}:${Date.now()}`,
      payload: {
        title:     hwTitle,
        status,
        score:     score ?? null,
        max_score: maxScore ?? null,
        feedback:  feedback ?? null,
      },
    }])
  }
}

/** Добавлен результат пробного экзамена */
export async function notifyMockExamResult(
  profileId: string,
  examTitle: string,
  score:     number,
  maxScore:  number,
) {
  const pct = Math.round(score / maxScore * 100)
  await send([{
    user_id: profileId,
    title:   '📊 Результат пробника',
    message: `«${examTitle}» — ${score}/${maxScore} б. (${pct}%)`,
    type:    pct >= 80 ? 'success' : pct >= 60 ? 'info' : 'warning',
  }])
}

/** Занятие перенесено: уведомить всех студентов группы */
export async function notifyLessonRescheduled(
  groupId:        string,
  lessonId:       string,
  lessonTitle:    string,
  oldScheduledAt: string,
  newScheduledAt: string,
) {
  const { data: members } = await supabase
    .from('group_students')
    .select('students(profile_id)')
    .eq('group_id', groupId)

  const profiles = (members || [])
    .map((m: any) => m.students?.profile_id as string)
    .filter(Boolean)

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  await send(
    profiles.map(pid => ({
      user_id: pid,
      title:   '🔄 Занятие перенесено',
      message: `«${lessonTitle}»: ${fmt(oldScheduledAt)} → ${fmt(newScheduledAt)}`,
      type:    'warning' as NotifType,
    }))
  )

  await enqueue(
    profiles.map(pid => ({
      profile_id:        pid,
      channel:           'telegram' as const,
      event_type:        'lesson_rescheduled',
      entity_type:       'lesson',
      entity_id:         lessonId,
      deduplication_key: `lesson_rescheduled:${lessonId}:${pid}:${newScheduledAt}`,
      payload: {
        title:            lessonTitle,
        // ISO, а не готовая строка: вид даты собирает воркер (formatWhen).
        // Раньше сюда клали «05.08.2026, 18:00» — воркер такую строку разобрать
        // не может и печатал её как есть, машинной.
        old_scheduled_at: oldScheduledAt,
        new_scheduled_at: newScheduledAt,
      },
    }))
  )
}

/** Занятие отменено: уведомить всех студентов группы */
export async function notifyLessonCancelled(
  groupId:     string,
  lessonId:    string,
  lessonTitle: string,
  scheduledAt: string,
  groupName:   string,
) {
  const { data: members } = await supabase
    .from('group_students')
    .select('students(profile_id)')
    .eq('group_id', groupId)

  const profiles = (members || [])
    .map((m: any) => m.students?.profile_id as string)
    .filter(Boolean)

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  await send(
    profiles.map(pid => ({
      user_id: pid,
      title:   '❌ Занятие отменено',
      message: `«${lessonTitle}» ${fmt(scheduledAt)}, группа ${groupName}`,
      type:    'warning' as NotifType,
    }))
  )

  await enqueue(
    profiles.map(pid => ({
      profile_id:        pid,
      channel:           'telegram' as const,
      event_type:        'lesson_cancelled',
      entity_type:       'lesson',
      entity_id:         lessonId,
      deduplication_key: `lesson_cancelled:${lessonId}:${pid}`,
      payload: {
        title:        lessonTitle,
        // ISO — см. комментарий в notifyLessonRescheduled
        scheduled_at: scheduledAt,
        group_name:   groupName,
      },
    }))
  )
}
