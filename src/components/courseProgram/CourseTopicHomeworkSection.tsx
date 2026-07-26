import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2, Users, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ATTEMPT_STATUS_TONE, gradeScaleMax, type TopicHomeworkAttemptStatus } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

interface Module {
  id: string
  title: string
  topics: { id: string; title: string }[]
}

interface RosterStudent {
  studentId: string
  name: string
}

interface TopicHomework {
  id: string
  topic_id: string
  title: string
  grade_scale: 'five' | 'hundred' | null
  is_published: boolean
}

interface TopicHomeworkAttempt {
  id: string
  homework_id: string
  student_id: string
  attempt_number: number
  status: TopicHomeworkAttemptStatus
  submitted_at: string | null
  created_at: string
  updated_at: string
  topic_homework_reviews?: Array<{
    decision: string
    score: number | null
    created_at: string
  }>
}

interface StudentAttemptStatus {
  status: TopicHomeworkAttemptStatus
  score: number | null
  submittedAt: string | null
}

const ATTEMPT_STATUS_LABEL: Record<TopicHomeworkAttemptStatus, string> = {
  draft: 'Не сдано',
  submitted: 'На проверке',
  returned_for_revision: 'На доработке',
  accepted: 'Выполнено',
}

const ATTEMPT_STATUS_BADGE_COLORS: Record<TopicHomeworkAttemptStatus, string> = {
  accepted: 'bg-emerald-50 text-emerald-700',
  submitted: 'bg-blue-50 text-blue-700',
  returned_for_revision: 'bg-amber-50 text-amber-700',
  draft: 'bg-gray-100 text-gray-600',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getLatestAttempt(
  attempts: TopicHomeworkAttempt[],
  homeworkId: string,
  studentId: string,
): TopicHomeworkAttempt | null {
  return (
    attempts
      .filter(a => a.homework_id === homeworkId && a.student_id === studentId)
      .sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null
  )
}

function getLatestReview(
  attempt: TopicHomeworkAttempt,
) {
  const reviews = attempt.topic_homework_reviews || []
  return reviews.length > 0 ? reviews[reviews.length - 1] : null
}

function getStudentAttemptStatus(
  homeworkId: string,
  studentId: string,
  attempts: TopicHomeworkAttempt[],
): StudentAttemptStatus {
  const latest = getLatestAttempt(attempts, homeworkId, studentId)

  if (!latest) {
    return { status: 'draft', score: null, submittedAt: null }
  }

  if (latest.status === 'accepted') {
    const review = getLatestReview(latest)
    return { status: 'accepted', score: review?.score ?? null, submittedAt: latest.submitted_at }
  }

  return { status: latest.status, score: null, submittedAt: latest.submitted_at }
}

export function CourseTopicHomeworkSection({ courseId, modules }: { courseId: string; modules: Module[] }) {
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [homeworks, setHomeworks] = useState<TopicHomework[]>([])
  const [attempts, setAttempts] = useState<TopicHomeworkAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())

  const cancelled = { value: false }

  useEffect(() => {
    const abortController = new AbortController()

    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        // Get all topic IDs
        const allTopicIds = modules.flatMap(m => m.topics.map(t => t.id))
        if (allTopicIds.length === 0) {
          setRoster([])
          setHomeworks([])
          setAttempts([])
          return
        }

        // Load roster
        const rosterResult = (await supabase
          .from('group_students')
          .select('student_id, groups!inner(course_id), students!inner(id, profiles!inner(full_name))')
          .eq('groups.course_id', courseId)) as any

        if (rosterResult.error) throw new Error(rosterResult.error.message)

        const rosterData = (rosterResult.data || []) as any[]
        const rosterMap = new Map<string, string>()
        for (const row of rosterData) {
          const studentId = row.student_id
          const name = row.students?.profiles?.full_name || 'Ученик'
          if (!rosterMap.has(studentId)) {
            rosterMap.set(studentId, name)
          }
        }
        const rosterArray: RosterStudent[] = Array.from(rosterMap.entries()).map(([studentId, name]) => ({
          studentId,
          name,
        }))

        // Load homeworks
        const homeworksResult = (await supabase
          .from('topic_homework')
          .select('id, topic_id, title, grade_scale, is_published')
          .in('topic_id', allTopicIds)) as any

        if (homeworksResult.error) throw new Error(homeworksResult.error.message)

        const homeworksData = (homeworksResult.data || []) as TopicHomework[]

        // Load attempts
        if (homeworksData.length > 0) {
          const hwIds = homeworksData.map(hw => hw.id)
          const attemptsResult = (await supabase
            .from('topic_homework_attempts')
            .select('*, topic_homework_reviews(decision, score, created_at)')
            .in('homework_id', hwIds)) as any

          if (attemptsResult.error) throw new Error(attemptsResult.error.message)

          const attemptsData = (attemptsResult.data || []) as TopicHomeworkAttempt[]

          if (!cancelled.value) {
            setRoster(rosterArray)
            setHomeworks(homeworksData)
            setAttempts(attemptsData)
          }
        } else {
          if (!cancelled.value) {
            setRoster(rosterArray)
            setHomeworks([])
            setAttempts([])
          }
        }
      } catch (e: any) {
        if (!cancelled.value) {
          setError(e.message || 'Не удалось загрузить данные')
        }
      } finally {
        if (!cancelled.value) {
          setLoading(false)
        }
      }
    }

    loadData()

    return () => {
      cancelled.value = true
      abortController.abort()
    }
  }, [courseId, modules])

  const toggleTopic = (topicId: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }

  // Calculate statistics
  const getTopicStats = (topicId: string, topicHomeworks: TopicHomework[]) => {
    const stats = {
      accepted: 0,
      submitted: 0,
      returned_for_revision: 0,
      draft: 0,
    }

    for (const hw of topicHomeworks) {
      for (const student of roster) {
        const status = getStudentAttemptStatus(hw.id, student.studentId, attempts)
        stats[status.status]++
      }
    }

    return stats
  }

  const getTotalStats = () => {
    const stats = {
      accepted: 0,
      submitted: 0,
      returned_for_revision: 0,
      draft: 0,
    }

    for (const hw of homeworks) {
      for (const student of roster) {
        const status = getStudentAttemptStatus(hw.id, student.studentId, attempts)
        stats[status.status]++
      }
    }

    return stats
  }

  const totalStats = getTotalStats()
  const totalHomeworks = homeworks.length
  const totalAssignments = totalHomeworks * roster.length
  const completedAssignments = totalStats.accepted

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex gap-2">
          <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
    )
  }

  if (roster.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
        <Users size={32} className="mx-auto mb-3 opacity-30 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">В курсе пока нет учеников</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      {totalHomeworks > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800 font-medium">
            Выполнено {completedAssignments} из {totalAssignments} работ по курсу
          </p>
        </div>
      )}

      {/* Module sections */}
      {modules.map(module => {
        const moduleTopicsWithHw = module.topics.filter(topic =>
          homeworks.some(hw => hw.topic_id === topic.id),
        )

        return (
          <div key={module.id} className="space-y-2">
            {/* Module header */}
            <div className="bg-primary-50/50 px-4 py-2 rounded-lg">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">{module.title}</h3>
            </div>

            {/* Topics in module */}
            {module.topics.map(topic => {
              const topicHomeworks = homeworks.filter(hw => hw.topic_id === topic.id)
              const isExpanded = expandedTopics.has(topic.id)
              const stats = getTopicStats(topic.id, topicHomeworks)

              if (topicHomeworks.length === 0) {
                return (
                  <div key={topic.id} className="px-4 py-3 rounded-lg border border-gray-100 bg-white/50">
                    <p className="text-sm text-gray-500">
                      {topic.title} — <span className="italic text-gray-400">ДЗ не создано</span>
                    </p>
                  </div>
                )
              }

              return (
                <div key={topic.id} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  {/* Topic header (collapsible) */}
                  <button
                    onClick={() => toggleTopic(topic.id)}
                    className="w-full px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {isExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                      <span className="text-sm font-medium text-gray-900 truncate">{topic.title}</span>
                    </div>

                    {/* Status badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      {stats.accepted > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                          <span>✓</span> {stats.accepted}
                        </span>
                      )}
                      {stats.submitted > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                          <span>⏳</span> {stats.submitted}
                        </span>
                      )}
                      {stats.returned_for_revision > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                          <span>↻</span> {stats.returned_for_revision}
                        </span>
                      )}
                      {stats.draft > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                          <span>—</span> {stats.draft}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded table */}
                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ученик</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Статус</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Балл</th>
                              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Дата сдачи</th>
                            </tr>
                          </thead>
                          <tbody>
                            {roster.map((student, idx) => {
                              // For simplicity, show status for the first homework in topic
                              // If there are multiple homeworks, could aggregate or show per-hw
                              const firstHw = topicHomeworks[0]
                              if (!firstHw) return null

                              const studentStatus = getStudentAttemptStatus(firstHw.id, student.studentId, attempts)
                              const attempt = getLatestAttempt(attempts, firstHw.id, student.studentId)
                              const review = attempt ? getLatestReview(attempt) : null
                              const maxScore = gradeScaleMax(firstHw.grade_scale)

                              return (
                                <tr
                                  key={student.studentId}
                                  className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                                >
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-900">{student.name}</span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span
                                      className={cn(
                                        'inline-block px-2 py-0.5 rounded-md text-xs font-medium',
                                        ATTEMPT_STATUS_BADGE_COLORS[studentStatus.status],
                                      )}
                                    >
                                      {ATTEMPT_STATUS_LABEL[studentStatus.status]}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-600">
                                      {studentStatus.status === 'accepted' && studentStatus.score !== null && maxScore
                                        ? `${studentStatus.score}/${maxScore}`
                                        : '—'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="text-sm text-gray-600">{formatDate(studentStatus.submittedAt)}</span>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      {homeworks.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-gray-700">В этом курсе нет домашних заданий по темам</p>
        </div>
      )}
    </div>
  )
}
