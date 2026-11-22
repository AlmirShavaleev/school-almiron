import { supabase } from '@/lib/supabase'
import { ownStudentRow } from '@/lib/ownStudent'

/**
 * Данные шапки темы: запускаем независимые чтения одновременно с поиском
 * students.id. Раньше страница ждала этот lookup и лишь затем выполняла
 * четыре других запроса — лишняя последовательная сетевая задержка.
 *
 * Авторизация НЕ переезжает в браузер: данные каждой таблицы по-прежнему
 * ограничены RLS Supabase, а без своей строки students ничего не отдаём UI.
 * В предпросмотре у персонала своей строки students может не быть.
 */
export async function fetchStudentTopicShell(params: {
  topicId: string
  groupId: string
  profileId: string
  preview: boolean
}) {
  const { topicId, groupId, profileId, preview } = params
  const [studentRes, topicRes, groupRes, homeworkRes, testRes] = await Promise.all([
    preview ? Promise.resolve({ data: { id: 'preview' } }) : ownStudentRow(profileId),
    // Оставляем *, чтобы новые поля kind/lesson_format работали и со
    // смешанными версиями схемы (это прежнее поведение).
    supabase.from('topics')
      .select('*, modules(id, title, courses(id, title, subject))')
      .eq('id', topicId).single(),
    supabase.from('groups')
      .select('id, name').eq('id', groupId).single(),
    // Предпросмотр не должен показывать черновик ДЗ персонала ученику.
    preview
      ? supabase.from('topic_homework')
        .select('id', { count: 'exact', head: true })
        .eq('topic_id', topicId).eq('is_published', true)
      : supabase.from('topic_homework')
        .select('id', { count: 'exact', head: true })
        .eq('topic_id', topicId),
    supabase.from('topic_test_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId),
  ])

  if (!preview && !studentRes.data) return null

  return {
    topic: topicRes.data,
    group: groupRes.data,
    hasHomework: (homeworkRes.count ?? 0) > 0,
    hasTest: (testRes.count ?? 0) > 0,
  }
}
