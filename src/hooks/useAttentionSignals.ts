import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  overlapSignals, speedSignals,
  type AttentionSignal, type VariantRun, type WrongAnswer,
} from '@/lib/attentionSignals'

/**
 * Сигналы внимания по тестированиям ученика.
 *
 * Таблицы `test_variant_*` — зона чата тестов; отсюда они только ЧИТАЮТСЯ,
 * ничего не пишется и не меняется.
 *
 * Границы видимости держит RLS, и они разные: админ видит все прохождения,
 * преподаватель — только по СВОИМ выдачам (`auth_is_assigner`), куратор к
 * ответам не допущен вовсе. Поэтому пустой список здесь означает «в видимых
 * данных ничего не нашлось», а не «ничего не было» — так и написано в
 * интерфейсе. Молчать об этом нельзя: пустой список, выглядящий как вывод, —
 * ровно та ошибка, от которой предостерегает CLAUDE.md.
 */
export function useAttentionSignals(studentId: string | null) {
  const [signals, setSignals] = useState<AttentionSignal[]>([])
  const [comparable, setComparable] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!studentId) { setSignals([]); setComparable(0); setLoading(false); return }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function load(id: string) {
      const runFields = 'id, variant_id, assignment_id, student_id, started_at, submitted_at, completed_at, '
        + 'variant:test_variants(id, title), assignment:test_variant_assignments(id, group_id)'

      const { data: mineRaw, error: err } = await supabase
        .from('test_variant_student_assignments')
        .select(runFields)
        .eq('student_id', id)

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }

      const mine = toRuns(mineRaw ?? [])
      if (mine.length === 0) {
        setSignals([]); setComparable(0); setLoading(false)
        return
      }

      const variantIds = Array.from(new Set(mine.map(r => r.variantId)))
      const { data: peersRaw } = await supabase
        .from('test_variant_student_assignments')
        .select(runFields)
        .in('variant_id', variantIds)
        .neq('student_id', id)

      if (cancelled) return
      const peers = toRuns(peersRaw ?? [])

      // Неверные ответы — только по тем прохождениям, что нужны для сравнения.
      const runIds = [...mine.map(r => r.id), ...peers.map(r => r.id)]
      const { data: wrongRaw } = await supabase
        .from('test_variant_answers')
        .select('student_assignment_id, variant_item_id, answer_normalized, answer_raw, is_correct')
        .in('student_assignment_id', runIds)
        .eq('is_correct', false)

      if (cancelled) return
      const wrong: WrongAnswer[] = (wrongRaw ?? []).map((row: any) => ({
        runId: row.student_assignment_id,
        itemId: row.variant_item_id,
        answer: row.answer_normalized ?? row.answer_raw ?? null,
      }))
      const mineIds = new Set(mine.map(r => r.id))

      // Имена соседей: те, кого вызывающему видно. Кого не видно — сигнал
      // всё равно показываем, но без имени: скрывать находку из-за подписи
      // было бы хуже, чем показать её обезличенной.
      const peerStudentIds = Array.from(new Set(peers.map(r => r.studentId)))
      let peerNames: Record<string, string> = {}
      if (peerStudentIds.length > 0) {
        const { data: students } = await supabase
          .from('students')
          .select('id, profiles!inner(full_name)')
          .in('id', peerStudentIds)
        if (cancelled) return
        peerNames = Object.fromEntries(
          ((students ?? []) as any[]).map(s => [s.id, s.profiles?.full_name ?? null]),
        )
      }

      setSignals([
        ...speedSignals(mine, peers),
        ...overlapSignals({
          mine,
          peers,
          myWrong: wrong.filter(w => mineIds.has(w.runId)),
          peerWrong: wrong.filter(w => !mineIds.has(w.runId)),
          peerNames,
        }),
      ])
      setComparable(peers.length)
      setLoading(false)
    }

    void load(studentId)
    return () => { cancelled = true }
  }, [studentId, tick])

  return { signals, comparable, loading, error, reload }
}

function toRuns(raw: unknown[]): VariantRun[] {
  return (raw as any[]).map(row => ({
    id: row.id,
    variantId: row.variant_id,
    variantTitle: row.variant?.title ?? 'Тестирование',
    studentId: row.student_id,
    groupId: row.assignment?.group_id ?? null,
    startedAt: row.started_at ?? null,
    // Сдача может быть отмечена двумя полями: берём то, что есть.
    finishedAt: row.submitted_at ?? row.completed_at ?? null,
  }))
}
