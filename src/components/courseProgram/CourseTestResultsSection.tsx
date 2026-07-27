import { useState, useEffect } from 'react'
import { Loader2, Users, AlertCircle } from 'lucide-react'
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
  completed_at: string | null
}

interface StudentTestResult {
  status: 'in_progress' | 'completed' | 'not_started'
  score: number | null
  maxScore: number | null
  completedAt: string | null
}

function getStudentTestResult(
  assignmentId: string,
  studentId: string,
  attempts: TopicTestAttempt[],
): StudentTestResult {
  const attempt = attempts.find(a => a.assignment_id === assignmentId && a.student_id === studentId)

  if (!attempt) {
    return { status: 'not_started', score: null, maxScore: null, completedAt: null }
  }

  if (attempt.status === 'in_progress') {
    return { status: 'in_progress', score: null, maxScore: null, completedAt: null }
  }

  return {
    status: 'completed',
    score: attempt.total_points,
    maxScore: attempt.max_points,
    completedAt: attempt.completed_at,
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
            .select('id, assignment_id, student_id, status, total_points, max_points, completed_at')
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

  // Calculate statistics
  const completedAttempts = attempts.filter(a => a.status === 'completed').length
  const totalPossible = assignments.length * roster.length

  // Group assignments by topic
  const assignmentsByTopic = new Map<string, TopicTestAssignment[]>()
  for (const assignment of assignments) {
    const topicId = assignment.topic_id
    if (!assignmentsByTopic.has(topicId)) {
      assignmentsByTopic.set(topicId, [])
    }
    assignmentsByTopic.get(topicId)!.push(assignment)
  }

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

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm text-blue-800 font-medium">
          Пройдено {completedAttempts} из {totalPossible} возможных тестов
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-40">
                Ученик
              </th>
              {assignments.map(assignment => (
                <th key={assignment.id} className="px-3 py-3 text-center text-xs font-medium text-gray-500 min-w-[160px]">
                  <div
                    className="truncate"
                    title={assignment.topic_tests?.title || 'Тест'}
                  >
                    <div className="font-medium">{assignment.topic_tests?.title || 'Тест'}</div>
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 min-w-[100px]">
                Средний %
              </th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student, idx) => (
              <tr
                key={student.studentId}
                className={cn(
                  'border-b border-gray-100',
                  idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                )}
              >
                <td className="px-4 py-3 sticky left-0 z-10 bg-inherit text-sm font-medium text-gray-900">
                  {student.name}
                </td>
                {assignments.map(assignment => {
                  const result = getStudentTestResult(assignment.id, student.studentId, attempts)
                  const percent = result.score !== null && result.maxScore !== null
                    ? scorePercent(result.score, result.maxScore)
                    : null

                  return (
                    <td key={assignment.id} className="px-3 py-3 text-center">
                      {result.status === 'not_started' && (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                      {result.status === 'in_progress' && (
                        <div>
                          <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                            в процессе
                          </span>
                        </div>
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
                          </div>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="px-3 py-3 text-center">
                  {(() => {
                    const percents: (number | null)[] = assignments.map(a => getAssignmentAvgPercent(a.id))
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
              </tr>
            ))}
            {/* Average row */}
            <tr className="bg-gray-50 border-t-2 border-gray-200">
              <td className="px-4 py-3 sticky left-0 z-10 bg-gray-50 text-sm font-semibold text-gray-700">
                Средний %
              </td>
              {assignments.map(assignment => {
                const avgPercent = getAssignmentAvgPercent(assignment.id)
                return (
                  <td key={assignment.id} className="px-3 py-3 text-center">
                    {avgPercent !== null ? (
                      <span className={cn('text-sm font-medium', getScoreColor(avgPercent))}>
                        {avgPercent}%
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">—</span>
                    )}
                  </td>
                )
              })}
              <td className="px-3 py-3 text-center">
                {(() => {
                  const allPercents: (number | null)[] = assignments.flatMap(a => getAssignmentAvgPercent(a.id))
                  const validPercents = allPercents.filter((p): p is number => p !== null)
                  if (validPercents.length === 0) return <span className="text-gray-400 text-sm">—</span>
                  const totalAvg = Math.round(validPercents.reduce((s, p) => s + p, 0) / validPercents.length)
                  return (
                    <span className={cn('text-sm font-semibold', getScoreColor(totalAvg))}>
                      {totalAvg}%
                    </span>
                  )
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
