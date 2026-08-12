import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useMyStudentId } from '@/hooks/useMyTopicHomework'
import { useStudentTopicJournal } from '@/hooks/useStudentTopicJournal'
import { isTopicOpen } from '@/lib/topicAvailability'
import {
  courseProgress, topicGroups, topicSections,
  type TopicGroupKey, type TopicProgress,
} from '@/lib/topicProgress'
import { scorePercent } from '@/lib/studentInsights'
import type { TopicSection } from '@/lib/topicMaterialItems'

interface TopicRow {
  id: string
  title: string
  is_open: boolean | null
  available_from: string | null
}

export interface MyProgress {
  /** Завершённые темы к открытым — главный показатель (решение владельца 12.08). */
  topics: { done: number; total: number; percent: number }
  homework: { accepted: number; submitted: number; returned: number; pending: number; total: number }
  /** Средний балл по принятым работам в процентах; null — принятых с оценкой нет. */
  averagePercent: number | null
}

/**
 * Прогресс ученика по ЖИВОМУ контуру.
 *
 * До §122 «Мой прогресс» стоял на двух мёртвых источниках сразу: легаси
 * (`useStudentProfile` → attendance/homework_submissions/mock_exam_results, все
 * пусты) и Homework V2 (`get_student_homework_summary` → `_homework_v2_base`,
 * `homework_assignments` тоже пуст). Из-за этого у ученика с принятой работой и
 * оценкой 5 экран показывал сплошные нули.
 *
 * Здесь источник один — `get_student_topic_journal` (ДЗ и тесты тем) плюс
 * отметки разделов. Правило «тема завершена» не переписывается: оно живёт в
 * `lib/topicProgress` и общее со страницей темы.
 */
export function useMyProgress() {
  const { studentId, loading: resolvingStudent } = useMyStudentId()
  const { journal, loading: loadingJournal, error: journalError } = useStudentTopicJournal(studentId)

  const [topics, setTopics] = useState<TopicRow[]>([])
  const [groupsByTopic, setGroupsByTopic] = useState<Record<string, TopicGroupKey[]>>({})
  const [marksByTopic, setMarksByTopic] = useState<Record<string, Set<TopicGroupKey>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (resolvingStudent || loadingJournal) return
    if (!studentId) { setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load(sid: string) {
      // Темы ученика отдаёт RLS (`course_student_can_see_topic`) — клиентского
      // сужения по курсам здесь нет и быть не должно.
      const { data: topicRows, error: topicErr } = await supabase
        .from('topics')
        .select('id, title, is_open, available_from')

      if (cancelled) return
      if (topicErr) { setError(topicErr.message); setLoading(false); return }

      const open = (topicRows ?? []).filter(t => isTopicOpen(t as TopicRow)) as TopicRow[]
      const ids = open.map(t => t.id)
      if (ids.length === 0) {
        setTopics([]); setGroupsByTopic({}); setMarksByTopic({}); setLoading(false)
        return
      }

      const [materialsRes, marksRes] = await Promise.all([
        supabase.from('topic_material_items').select('topic_id, section, kind').in('topic_id', ids),
        supabase.from('topic_section_marks').select('topic_id, group_key')
          .eq('student_id', sid).in('topic_id', ids),
      ])
      if (cancelled) return

      // Какие рубрики у темы есть — считает `topicSections`, тот же расчёт, что
      // и на странице темы. ДЗ и тесты берём из журнала: он уже знает, что
      // ученику выдано.
      const counts: Record<string, Partial<Record<TopicSection, number>>> = {}
      const hasVideo: Record<string, boolean> = {}
      for (const row of (materialsRes.data ?? []) as any[]) {
        if (row.kind === 'video') { hasVideo[row.topic_id] = true; continue }
        if (!row.section) continue
        const bucket = counts[row.topic_id] ?? (counts[row.topic_id] = {})
        bucket[row.section as TopicSection] = (bucket[row.section as TopicSection] ?? 0) + 1
      }

      const homeworkTopics = new Set((journal?.homework ?? []).map(h => h.topic_id))
      const testTopics = new Set((journal?.tests ?? []).map(t => t.topic_id))

      // Рубрики → ГРУППЫ (§121): отметка стоит на группе, и завершённость
      // считается по ним же. Обе функции — из `lib/topicProgress`.
      const groups: Record<string, TopicGroupKey[]> = {}
      for (const topic of open) {
        groups[topic.id] = topicGroups(topicSections({
          hasVideo: !!hasVideo[topic.id],
          sectionCounts: counts[topic.id] ?? {},
          hasHomework: homeworkTopics.has(topic.id),
          hasTest: testTopics.has(topic.id),
        }))
      }

      const marks: Record<string, Set<TopicGroupKey>> = {}
      for (const row of (marksRes.data ?? []) as any[]) {
        const bucket = marks[row.topic_id] ?? (marks[row.topic_id] = new Set())
        bucket.add(row.group_key as TopicGroupKey)
      }

      setTopics(open)
      setGroupsByTopic(groups)
      setMarksByTopic(marks)
      setLoading(false)
    }

    void load(studentId)
    return () => { cancelled = true }
  }, [studentId, resolvingStudent, loadingJournal, journal])

  const progress = useMemo<MyProgress>(() => {
    const acceptedTopics = new Set(
      (journal?.homework ?? []).filter(h => h.status === 'accepted').map(h => h.topic_id),
    )

    const perTopic: TopicProgress[] = topics.map(t => ({
      groups: groupsByTopic[t.id] ?? [],
      marks: marksByTopic[t.id] ?? new Set<TopicGroupKey>(),
      homeworkAccepted: acceptedTopics.has(t.id),
    }))

    const summary = journal?.summary
    // Шкалы приводим к процентам — пятёрку и сотню в одну среднюю складывать
    // нельзя (правило §111.2, тот же `scorePercent`).
    const parts = [
      scorePercent(summary?.avg_score_five ?? null, 'five'),
      scorePercent(summary?.avg_score_hundred ?? null, 'hundred'),
    ].filter((v): v is number => v != null)

    return {
      topics: courseProgress(perTopic),
      homework: {
        accepted: summary?.hw_accepted ?? 0,
        submitted: summary?.hw_submitted ?? 0,
        returned: summary?.hw_returned ?? 0,
        pending: summary?.hw_pending ?? 0,
        total: summary?.hw_total ?? 0,
      },
      averagePercent: parts.length === 0
        ? null
        : Math.round(parts.reduce((s, v) => s + v, 0) / parts.length),
    }
  }, [topics, groupsByTopic, marksByTopic, journal])

  return {
    progress,
    loading: loading || loadingJournal || resolvingStudent,
    error: error ?? journalError,
  }
}
