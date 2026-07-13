import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeAnswer } from '@/utils/variantAnswerNormalize'
import type { AttachmentRecord } from '@/components/variant/ManualAnswerInput'
import type { CatalogTaskAsset } from '@/hooks/useCatalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface VariantItem {
  item_id:        string
  variant_id:     string
  task_id:        string
  item_position:  number
  points:         number
  grading_type:   'auto' | 'manual'
  task_ext_id:    number | null
  section_id:     string | null
  subject:        string
  exam_type:      string
  statement_html: string
  has_answer:     boolean
  has_solution:   boolean
  exam_part:            number | null
  source_type:          string
  /** Populated by the server only once the assignment is submitted/completed. */
  solution_html:        string | null
  solution_plan_html:   string | null
  grade_criteria_html:  string | null
  answer_html:          string | null
  assets?:              CatalogTaskAsset[]
}

export interface VariantAttemptState {
  status:              'not_started' | 'in_progress' | 'submitted' | 'completed' | 'overdue' | 'cancelled' | 'locked'
  started_at:          string | null
  submitted_at:        string | null
  completed_at:        string | null
  answered_count:      number | null
  correct_count:       number | null
  score:               number | null
  max_score:           number | null
  percentage:          number | null
  grading_status:      'not_submitted' | 'auto_graded' | 'needs_review' | 'graded' | null
  manual_review_count: number | null
}

/** Per-item save state visible in the UI */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Per-item grading result visible to student after review */
export interface GradedAnswer {
  points_earned:   number | null
  points_max:      number | null
  teacher_comment: string | null
  grading_status:  string | null
}

interface UseVariantAttemptReturn {
  items:              VariantItem[]
  answers:            Record<string, string>
  saveStates:         Record<string, SaveState>
  attachments:        Record<string, AttachmentRecord[]>
  gradedAnswers:      Record<string, GradedAnswer>
  attempt:            VariantAttemptState | null
  loading:            boolean
  error:              string | null
  startAttempt:       () => Promise<void>
  setAnswer:          (itemId: string, raw: string) => void
  addAttachment:      (itemId: string, att: AttachmentRecord) => void
  removeAttachment:   (itemId: string, attId: string) => void
  submitVariant:      () => Promise<void>
  submitting:         boolean
  submitError:        string | null
}

const DEBOUNCE_MS = 800

export function useVariantAttempt(
  studentAssignmentId: string | undefined,
  initialStatus: string,
  initialStartedAt: string | null,
  initialSubmittedAt: string | null,
  initialCompletedAt: string | null,
  availableFrom: string | null,
  initialScore?: number | null,
  initialMaxScore?: number | null,
  initialPercentage?: number | null,
  initialGradingStatus?: string | null,
  initialAnsweredCount?: number | null,
  initialCorrectCount?: number | null,
  initialManualReviewCount?: number | null,
): UseVariantAttemptReturn {
  const [items, setItems]               = useState<VariantItem[]>([])
  const [answers, setAnswers]           = useState<Record<string, string>>({})
  const [saveStates, setSaveStates]     = useState<Record<string, SaveState>>({})
  const [attachments, setAttachments]   = useState<Record<string, AttachmentRecord[]>>({})
  const [gradedAnswers, setGradedAnswers] = useState<Record<string, GradedAnswer>>({})
  const [attempt, setAttempt]           = useState<VariantAttemptState | null>(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [submitting, setSubmitting]     = useState(false)
  const [submitError, setSubmitError]   = useState<string | null>(null)

  // Debounce timers per item
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Latest save request seq per item (race-condition protection)
  const saveSeq = useRef<Record<string, number>>({})

  // Derive initial attempt state from props
  useEffect(() => {
    if (!studentAssignmentId) return

    const now = new Date()
    let status = initialStatus as VariantAttemptState['status']

    if (status === 'not_started' && availableFrom && new Date(availableFrom) > now) {
      status = 'locked'
    }

    setAttempt({
      status,
      started_at:          initialStartedAt,
      submitted_at:        initialSubmittedAt,
      completed_at:        initialCompletedAt,
      answered_count:      null,
      correct_count:       null,
      score:               null,
      max_score:           null,
      percentage:          null,
      grading_status:      null,
      manual_review_count: null,
    })
  }, [studentAssignmentId, initialStatus, initialStartedAt, initialSubmittedAt, initialCompletedAt, availableFrom])

  // Populate score/grading fields from props once they arrive (submitted/completed state)
  useEffect(() => {
    if (!studentAssignmentId) return
    if (initialScore == null && initialGradingStatus == null) return
    setAttempt(prev => {
      if (!prev) return prev
      if (prev.score !== null) return prev // already set (e.g. from submit RPC)
      return {
        ...prev,
        score:               initialScore ?? null,
        max_score:           initialMaxScore ?? null,
        percentage:          initialPercentage ?? null,
        grading_status:      (initialGradingStatus ?? null) as VariantAttemptState['grading_status'],
        answered_count:      initialAnsweredCount ?? null,
        correct_count:       initialCorrectCount ?? null,
        manual_review_count: initialManualReviewCount ?? null,
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAssignmentId, initialScore, initialGradingStatus])

  // Load items + existing draft answers once the attempt is in_progress
  useEffect(() => {
    if (!studentAssignmentId) return
    if (initialStatus !== 'in_progress' && initialStatus !== 'submitted' && initialStatus !== 'completed') return

    let cancelled = false
    setLoading(true)

    Promise.all([
      db.rpc('get_variant_items_for_student', {
        p_student_assignment_id: studentAssignmentId,
      }),
      db
        .from('test_variant_answers')
        .select('variant_item_id, answer_raw, points_earned, points_max, teacher_comment, grading_status')
        .eq('student_assignment_id', studentAssignmentId),
      db
        .from('test_variant_answer_attachments')
        .select('id, variant_item_id, storage_path, file_name, file_size, mime_type, uploaded_at')
        .eq('student_assignment_id', studentAssignmentId),
    ]).then(([itemsRes, answersRes, attachRes]) => {
      if (cancelled) return
      if (itemsRes.error) {
        setError(itemsRes.error.message)
      } else {
        const itemRows = (itemsRes.data as VariantItem[]) ?? []
        const taskIds = [...new Set(itemRows.map(item => item.task_id).filter(Boolean))]

        if (!taskIds.length) {
          setItems(itemRows)
        } else {
          void loadAssetsForTaskIds(taskIds).then(assetsByTask => {
            if (cancelled) return
            setItems(itemRows.map(item => ({
              ...item,
              assets: assetsByTask[item.task_id] ?? [],
            })))
          })
        }
      }
      if (!answersRes.error && answersRes.data) {
        const map: Record<string, string> = {}
        const gradedMap: Record<string, GradedAnswer> = {}
        for (const row of answersRes.data) {
          map[row.variant_item_id] = row.answer_raw
          if (row.points_earned !== null || row.points_max !== null || row.teacher_comment || row.grading_status) {
            gradedMap[row.variant_item_id] = {
              points_earned:   row.points_earned ?? null,
              points_max:      row.points_max ?? null,
              teacher_comment: row.teacher_comment ?? null,
              grading_status:  row.grading_status ?? null,
            }
          }
        }
        setAnswers(map)
        setGradedAnswers(gradedMap)
      }
      if (!attachRes.error && attachRes.data) {
        const attMap: Record<string, AttachmentRecord[]> = {}
        for (const row of attachRes.data) {
          if (!attMap[row.variant_item_id]) attMap[row.variant_item_id] = []
          attMap[row.variant_item_id].push(row)
        }
        setAttachments(attMap)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentAssignmentId, initialStatus])

  const startAttempt = useCallback(async () => {
    if (!studentAssignmentId) return
    setError(null)

    const { data, error: rpcErr } = await db.rpc('start_variant_attempt', {
      p_student_assignment_id: studentAssignmentId,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      return
    }

    const result = data as { status: string; started_at: string }
    setAttempt(prev => prev ? {
      ...prev,
      status: result.status as VariantAttemptState['status'],
      started_at: result.started_at,
    } : null)

    // Load items now that we've started
    const { data: itemData, error: itemErr } = await db.rpc(
      'get_variant_items_for_student',
      { p_student_assignment_id: studentAssignmentId },
    )
    if (!itemErr) {
      const rows = (itemData as VariantItem[]) ?? []
      const taskIds = [...new Set(rows.map(item => item.task_id).filter(Boolean))]
      const assetsByTask = await loadAssetsForTaskIds(taskIds)
      setItems(rows.map(item => ({
        ...item,
        assets: assetsByTask[item.task_id] ?? [],
      })))
    }
  }, [studentAssignmentId])

  const addAttachment = useCallback((itemId: string, att: AttachmentRecord) => {
    setAttachments(prev => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), att],
    }))
  }, [])

  const removeAttachment = useCallback((itemId: string, attId: string) => {
    setAttachments(prev => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter(a => a.id !== attId),
    }))
  }, [])

  const setAnswer = useCallback((itemId: string, raw: string) => {
    setAnswers(prev => ({ ...prev, [itemId]: raw }))
    setSaveStates(prev => ({ ...prev, [itemId]: 'saving' }))

    // Debounce the actual RPC call
    clearTimeout(debounceTimers.current[itemId])
    const seq = (saveSeq.current[itemId] ?? 0) + 1
    saveSeq.current[itemId] = seq

    debounceTimers.current[itemId] = setTimeout(async () => {
      if (!studentAssignmentId) return

      const { error: saveErr } = await db.rpc('save_variant_answer', {
        p_student_assignment_id: studentAssignmentId,
        p_variant_item_id: itemId,
        p_answer_raw: raw,
      })

      // Ignore stale responses
      if (saveSeq.current[itemId] !== seq) return

      setSaveStates(prev => ({
        ...prev,
        [itemId]: saveErr ? 'error' : 'saved',
      }))
    }, DEBOUNCE_MS)
  }, [studentAssignmentId])

  const submitVariant = useCallback(async () => {
    if (!studentAssignmentId) return
    setSubmitting(true)
    setSubmitError(null)

    const { data, error: rpcErr } = await db.rpc('submit_variant', {
      p_student_assignment_id: studentAssignmentId,
    })

    setSubmitting(false)

    if (rpcErr) {
      setSubmitError(rpcErr.message)
      return
    }

    const result = data as {
      status:              string
      answered_count:      number
      correct_count:       number
      score:               number
      max_score:           number
      percentage:          number | null
      grading_status:      string
      manual_review_count: number
      submitted_at:        string
      completed_at:        string
    }

    setAttempt(prev => prev ? {
      ...prev,
      status:              result.status as VariantAttemptState['status'],
      submitted_at:        result.submitted_at,
      completed_at:        result.completed_at,
      answered_count:      result.answered_count,
      correct_count:       result.correct_count,
      score:               result.score,
      max_score:           result.max_score,
      percentage:          result.percentage,
      grading_status:      result.grading_status as VariantAttemptState['grading_status'],
      manual_review_count: result.manual_review_count,
    } : null)
  }, [studentAssignmentId])

  return {
    items,
    answers,
    saveStates,
    attachments,
    attempt,
    loading,
    error,
    startAttempt,
    setAnswer,
    addAttachment,
    removeAttachment,
    submitVariant,
    submitting,
    submitError,
    gradedAnswers,
  }
}

async function loadAssetsForTaskIds(taskIds: string[]): Promise<Record<string, CatalogTaskAsset[]>> {
  if (!taskIds.length) return {}
  const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
  const PAGE = 1000
  const CHUNK = 50

  for (let ci = 0; ci < taskIds.length; ci += CHUNK) {
    const chunk = taskIds.slice(ci, ci + CHUNK)
    for (let from = 0; ; from += PAGE) {
      const { data } = await db
        .from('catalog_task_assets')
        .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
        .in('task_id', chunk)
        .order('position')
        .range(from, from + PAGE - 1)
      if (!data || data.length === 0) break
      allAssets.push(...data)
      if (data.length < PAGE) break
    }
  }

  const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
  for (const asset of allAssets) {
    if (!assetsByTask[asset.task_id]) assetsByTask[asset.task_id] = []
    assetsByTask[asset.task_id].push(asset)
  }
  return assetsByTask
}
