import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight, Loader2, Users, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatScore, scorePercent } from '@/lib/topicTest'
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

interface TopicTestAssignment {
  id: string
  topic_id: string
  topic_tests: { id: string; title: string } | null
}

interface TopicTestAttempt {
  id: string
  assignment_id: string
  student_id: string
  status: 'in_progress' | 'completed'
  total_points: number | null
  max_points: number | null
  started_at: string | null
  completed_at: string | null
}

interface StudentTestResult {
  status: 'in_progress' | 'completed' | 'not_started'
  score: number | null
  maxScore: number | null
  completedAt: string | null
  /** Готовая подпись длительности прохождения ("12 мин", "1 ч 5 мин"), либо null если данных нет. */
  durationLabel: string | null
}

function getStudentTestResult(
  assignmentId: string,
  studentId: string,
  attempts: TopicTestAttempt[],
): StudentTestResult {
  const attempt = attempts.find(a => a.assignment_id === assignmentId && a.student_id === studentId)

  if (!attempt) {
    return { status: 'not_started', score: null, maxScore: null, completedAt: null, durationLabel: null }
  }

  if (attempt.status === 'in_progress') {
    return { status: 'in_progress', score: null, maxScore: null, completedAt: null, durationLabel: null }
  }

  return {
    status: 'completed',
    score: attempt.total_points,
    maxScore: attempt.max_points,
    completedAt: attempt.completed_at,
    durationLabel: formatDuration(attempt.started_at, attempt.completed_at),
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  const year = date.getFullYear()
  if (year < 2000) return '—'
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU')
}

/** Время выполнения теста: разница completed_at - started_at, либо null если данных не хватает. */
function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null
  const start = new Date(startedAt).getTime()
  const end = new Date(completedAt).getTime()
  if (isNaN(start) || isNaN(end) || end < start) return null

  const totalMinutes = Math.round((end - start) / 60000)
  if (totalMinutes < 1) return '< 1 мин'

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours} ч ${minutes} мин`
  return `${minutes} мин`
}

function getScoreColor(percent: number | null): string {
  if (percent === null) return 'text-gray-600'
  if (percent >= 70) return 'text-green-600'
  if (percent >= 40) return 'text-amber-600'
  return 'text-red-600'
}

export function CourseTestResultsSection({
  courseId,
  modules,
  refreshKey = 0,
}: {
  courseId: string
  modules: Module[]
  /** Растёт при закрытии модалки темы: тест могли прикрепить или открепить прямо там. */
  refreshKey?: number
}) {
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [assignments, setAssignments] = useState<TopicTestAssignment[]>([])
  const [attempts, setAttempts] = useState<TopicTestAttempt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())

  useEffect(() => {
    const cancelled = { value: false }
    const abortController = new AbortController()

    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        // Get all topic IDs
        const allTopicIds = modules.flatMap(m => m.topics.map(t => t.id))
        if (allTopicIds.length === 0) {
          setRoster([])
          setAssignments([])
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
        const rosterArray: RosterStudent[] = Array.from(rosterMap.entries())
          .map(([studentId, name]) => ({ studentId, name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

        // Load test assignments
        const assignmentsResult = (await supabase
          .from('topic_test_assignments')
          .select('id, topic_id, topic_tests(id, title)')
          .in('topic_id', allTopicIds)) as any

        if (assignmentsResult.error) throw new Error(assignmentsResult.error.message)

        const assignmentsData = (assignmentsResult.data || []) as TopicTestAssignment[]

        // Load attempts only if there are assignments
        if (assignmentsData.length > 0) {
          const assignmentIds = assignmentsData.map(a => a.id)
          const attemptsResult = (await supabase
            .from('topic_test_attempts')
            .select('id, assignment_id, student_id, status, total_points, max_points, started_at, completed_at')
            .in('assignment_id', assignmentIds)) as any

          if (attemptsResult.error) throw new Error(attemptsResult.error.message)

          const attemptsData = (attemptsResult.data || []) as TopicTestAttempt[]

          if (!cancelled.value) {
            setRoster(rosterArray)
            setAssignments(assignmentsData)
            setAttempts(attemptsData)
          }
        } else {
          if (!cancelled.value) {
            setRoster(rosterArray)
            setAssignments([])
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
  }, [courseId, modules, refreshKey])

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

  if (assignments.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
        <p className="text-sm font-medium text-gray-700">Тесты ещё не прикреплены к темам курса</p>
        <p className="mt-2 text-xs text-gray-500">
          Прикрепить тест можно в модалке темы → плитка «Тестирование»
        </p>
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

  // Summary stats
  const completedAttempts = attempts.filter(a => a.status === 'completed').length
  const totalPossible = assignments.length * roster.length

  // Calculate average percentage for each assignment
  const getAssignmentAvgPercent = (assignmentId: string): number | null => {
    const assignmentAttempts = attempts.filter(a => a.assignment_id === assignmentId && a.status === 'completed')
    if (assignmentAttempts.length === 0) return null

    const percents = assignmentAttempts
      .map(a => scorePercent(a.total_points, a.max_points))
      .filter((p): p is number => p !== null)

    if (percents.length === 0) return null
    return Math.round(percents.reduce((s, p) => s + p, 0) / percents.length)
  }

  const getTopicStats = (topicAssignments: TopicTestAssignment[]) => {
    const stats = { completed: 0, in_progress: 0, not_started: 0 }
    for (const assignment of topicAssignments) {
      for (const student of roster) {
        const result = getStudentTestResult(assignment.id, student.studentId, attempts)
        stats[result.status]++
      }
    }
    return stats
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm text-blue-800 font-medium">
          Пройдено {completedAttempts} из {totalPossible} возможных тестов
        </p>
      </div>

      {/* Module sections */}
      {modules.map(module => (
        <div key={module.id} className="space-y-2">
          {/* Module header */}
          <div className="bg-primary-50/50 px-4 py-2 rounded-lg">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-primary-700">{module.title}</h3>
          </div>

          {/* Topics in module */}
          {module.topics.map(topic => {
            const topicAssignments = assignments.filter(a => a.topic_id === topic.id)
            const isExpanded = expandedTopics.has(topic.id)

            if (topicAssignments.length === 0) {
              return (
                <div key={topic.id} className="px-4 py-3 rounded-lg border border-gray-100 bg-white/50">
                  <p className="text-sm text-gray-500">
                    {topic.title} — <span className="italic text-gray-400">тест не прикреплён</span>
                  </p>
                </div>
              )
            }

            const stats = getTopicStats(topicAssignments)

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
                    {stats.completed > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                        <span>✓</span> {stats.completed}
                      </span>
                    )}
                    {stats.in_progress > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
                        <span>⏳</span> {stats.in_progress}
                      </span>
                    )}
                    {stats.not_started > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                        <span>—</span> {stats.not_started}
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
                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-40">
                              Ученик
                            </th>
                            {topicAssignments.map(assignment => (
                              <th key={assignment.id} className="px-3 py-2 text-center text-xs font-medium text-gray-500 min-w-[160px]">
                                <div className="truncate" title={assignment.topic_tests?.title || 'Тест'}>
                                  {assignment.topic_tests?.title || 'Тест'}
                                </div>
                              </th>
                            ))}
                            {topicAssignments.length > 1 && (
                              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 min-w-[100px]">
                                Средний %
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {roster.map((student, idx) => (
                            <tr
                              key={student.studentId}
                              className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                            >
                              <td className="px-4 py-2 sticky left-0 z-10 bg-inherit text-sm font-medium text-gray-900">
                                {student.name}
                              </td>
                              {topicAssignments.map(assignment => {
                                const result = getStudentTestResult(assignment.id, student.studentId, attempts)
                                const percent = result.score !== null && result.maxScore !== null
                                  ? scorePercent(result.score, result.maxScore)
                                  : null

                                return (
                                  <td key={assignment.id} className="px-3 py-2 text-center">
                                    {result.status === 'not_started' && (
                                      <span className="text-gray-400 text-sm">—</span>
                                    )}
                                    {result.status === 'in_progress' && (
                                      <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                                        в процессе
                                      </span>
                                    )}
                                    {result.status === 'completed' && (
                                      <div className="space-y-0.5">
                                        <div>
                                          <span className={cn('text-sm font-medium', getScoreColor(percent))}>
                                            {formatScore(result.score, result.maxScore)}
                                          </span>
                                          {percent !== null && (
                                            <div className={cn('text-xs font-medium', getScoreColor(percent))}>
                                              {percent}%
                                            </div>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          {formatDate(result.completedAt)}
                                          {result.durationLabel && ` · ${result.durationLabel}`}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                )
                              })}
                              {topicAssignments.length > 1 && (
                                <td className="px-3 py-2 text-center">
                                  {(() => {
                                    const percents = topicAssignments.map(a => getAssignmentAvgPercent(a.id))
                                    const validPercents = percents.filter((p): p is number => p !== null)
                                    if (validPercents.length === 0) return <span className="text-gray-400 text-sm">—</span>
                                    const avg = Math.round(validPercents.reduce((s, p) => s + p, 0) / validPercents.length)
                                    return (
                                      <span className={cn('text-sm font-medium', getScoreColor(avg))}>
                                        {avg}%
                                      </span>
                                    )
                                  })()}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
