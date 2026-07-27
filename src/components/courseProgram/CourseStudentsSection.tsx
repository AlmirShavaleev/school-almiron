import { useState, useEffect } from 'react'
import { Loader2, Users, AlertCircle, MessageCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

interface StudentInfo {
  studentId: string
  profileId: string
  name: string
  email: string
  phone: string | null
  groupName: string
  enrolledAt: string | null
}

interface StudentRow {
  studentId: string
  profileId: string
  name: string
  email: string
  phone: string | null
  groupNames: Set<string>
  enrolledAt: string | null
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function CourseStudentsSection({ courseId }: { courseId: string }) {
  const [students, setStudents] = useState<StudentRow[]>([])
  const [telegramSet, setTelegramSet] = useState<Set<string>>(new Set())
  const [showTelegramColumn, setShowTelegramColumn] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cancelled = { value: false }

  useEffect(() => {
    const abortController = new AbortController()

    async function loadData() {
      try {
        setLoading(true)
        setError(null)

        // Load enrolled students
        let enrolledResult: any = await supabase
          .from('group_students')
          .select(
            'student_id, created_at, groups!inner(id, name, course_id), students!inner(id, profile_id, profiles!inner(id, full_name, email, phone))'
          )
          .eq('groups.course_id', courseId)

        // If error about created_at column, retry without it
        if (enrolledResult.error) {
          enrolledResult = await supabase
            .from('group_students')
            .select(
              'student_id, groups!inner(id, name, course_id), students!inner(id, profile_id, profiles!inner(id, full_name, email, phone))'
            )
            .eq('groups.course_id', courseId)

          if (enrolledResult.error) throw new Error(enrolledResult.error.message)
        }

        const enrolledData = (enrolledResult.data || []) as any[]

        // Deduplicate by studentId, collect groups
        const studentMap = new Map<string, StudentRow>()
        const profileIds: string[] = []

        for (const row of enrolledData) {
          const studentId = row.student_id
          const profileId = row.students?.profile_id
          const name = row.students?.profiles?.full_name || 'Ученик'
          const email = row.students?.profiles?.email || ''
          const phone = row.students?.profiles?.phone || null
          const groupName = row.groups?.name || ''
          const enrolledAt = (row as any).created_at || null

          if (!studentMap.has(studentId)) {
            studentMap.set(studentId, {
              studentId,
              profileId,
              name,
              email,
              phone,
              groupNames: new Set(),
              enrolledAt,
            })
            if (profileId) profileIds.push(profileId)
          }

          const student = studentMap.get(studentId)!
          if (groupName) student.groupNames.add(groupName)
        }

        // Load telegram connections
        let hasTelegramError = false
        if (profileIds.length > 0) {
          const telegramResult = await supabase
            .from('telegram_connections')
            .select('profile_id, is_enabled')
            .in('profile_id', profileIds)

          if (telegramResult.error) {
            hasTelegramError = true
          } else {
            const telegramData = (telegramResult.data || []) as any[]
            const connected = new Set<string>()
            for (const row of telegramData) {
              if (row.is_enabled) {
                connected.add(row.profile_id)
              }
            }
            setTelegramSet(connected)

            // Show column only if we have data or no error
            setShowTelegramColumn(connected.size > 0)
          }
        } else {
          setShowTelegramColumn(false)
        }

        // If telegram query failed, hide column
        if (hasTelegramError && profileIds.length > 0) {
          setShowTelegramColumn(false)
        }

        // Sort by name
        const sortedStudents = Array.from(studentMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name, 'ru')
        )

        if (!cancelled.value) {
          setStudents(sortedStudents)
        }
      } catch (e: any) {
        if (!cancelled.value) {
          setError(e.message || 'Не удалось загрузить список учеников')
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
  }, [courseId])

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

  if (students.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
        <Users size={32} className="mx-auto mb-3 opacity-30 text-gray-400" />
        <p className="text-sm font-medium text-gray-700">В курсе пока нет учеников</p>
        <p className="mt-1 text-sm text-gray-400">Зачисление — через приглашения на странице «Ученики»</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header with badge */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-gray-900">Ученики курса</h3>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-medium">
          {students.length}
        </span>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Ученик</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Группа</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Телефон</th>
                {showTelegramColumn && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Telegram</th>
                )}
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Зачислен</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student, idx) => (
                <tr
                  key={student.studentId}
                  className={cn('border-b border-gray-100', idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}
                >
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-gray-900">{student.name}</span>
                      <span className="text-xs text-gray-400">{student.email}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-sm text-gray-900">
                      {Array.from(student.groupNames).join(', ') || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-sm text-gray-600">{student.phone || '—'}</span>
                  </td>
                  {showTelegramColumn && (
                    <td className="px-4 py-2">
                      {telegramSet.has(student.profileId) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium">
                          <MessageCircle size={12} />
                          привязан
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium">
                          —
                        </span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <span className="text-sm text-gray-600">{formatDate(student.enrolledAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
