/**
 * Утилита для создания in-app уведомлений.
 * Вызывается из клиентского кода после соответствующих действий.
 */
import { supabase } from '@/lib/supabase'

type NotifType = 'info' | 'success' | 'warning' | 'error'

interface NotifPayload {
  user_id: string
  title:   string
  message?: string
  type:    NotifType
}

async function send(payloads: NotifPayload[]) {
  if (payloads.length === 0) return
  await supabase.from('notifications').insert(payloads as any)
}

/** Новое ДЗ: уведомить всех студентов группы */
export async function notifyNewHomework(
  groupId: string,
  hwTitle: string,
  dueDate: string,
) {
  const { data: members } = await supabase
    .from('group_students')
    .select('student_id, students(profile_id)')
    .eq('group_id', groupId)

  const payloads = (members || []).map((m: any) => ({
    user_id: m.students?.profile_id as string,
    title:   '📚 Новое домашнее задание',
    message: `«${hwTitle}» — срок сдачи ${dueDate}`,
    type:    'info' as NotifType,
  })).filter(p => p.user_id)

  await send(payloads)
}

/** ДЗ проверено / отправлено на доработку */
export async function notifyHomeworkChecked(
  profileId: string,
  hwTitle: string,
  status: 'checked' | 'revision',
  score?: number | null,
  maxScore?: number,
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
}

/** Добавлен результат пробного экзамена */
export async function notifyMockExamResult(
  profileId: string,
  examTitle: string,
  score: number,
  maxScore: number,
) {
  const pct = Math.round(score / maxScore * 100)
  await send([{
    user_id: profileId,
    title:   '📊 Результат пробника',
    message: `«${examTitle}» — ${score}/${maxScore} б. (${pct}%)`,
    type:    pct >= 80 ? 'success' : pct >= 60 ? 'info' : 'warning',
  }])
}
