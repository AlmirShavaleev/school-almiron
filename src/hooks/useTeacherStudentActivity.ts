import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PRESENCE_POLL_MS } from '@/lib/schoolPresence'
import { useAuthStore } from '@/store/authStore'

interface Student {
  student_id: string
  full_name: string
}

export interface StudentVisitDay {
  day: string
  visited: boolean
  first_visit_at: string | null
  seconds: number | null
}

interface WeeklyStudent extends Student {
  days: StudentVisitDay[]
}

interface HomeworkSubmission {
  attempt_id: string
  full_name: string
  topic_title: string
  submitted_at: string
}

function useActivityRows<T>(
  method: 'teacher_presence_online' | 'teacher_student_visits' | 'teacher_homework_submissions_today',
  courseIds: string[] | null,
  { poll, asOf }: { poll?: number; asOf?: string } = {},
) {
  const profile = useAuthStore(state => state.profile)
  const scope = courseIds === null ? null : [...new Set(courseIds)].sort()
  const enabled = Boolean(profile?.id && ['teacher', 'admin', 'owner'].includes(profile.role) && scope?.length !== 0)
  const query = useQuery({
    queryKey: [method, profile?.id, profile?.role, scope, asOf],
    enabled,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc(method as never, {
          p_course_ids: scope,
          ...(asOf ? { p_as_of: asOf } : {}),
        } as never)
        .abortSignal(signal)
        .overrideTypes<T[], { merge: false }>()
      if (error) throw error
      return data ?? []
    },
    staleTime: poll ?? 30_000,
    refetchInterval: poll,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: poll ? 'always' : true,
    retry: false,
  })

  return {
    rows: enabled && !query.isError ? query.data ?? [] : [],
    loading: enabled && query.isPending,
    failed: enabled && query.isError,
    reload: () => { if (enabled) void query.refetch() },
  }
}

export function useTeacherPresence(courseIds: string[] | null) {
  const { rows, ...state } = useActivityRows<Student>('teacher_presence_online', courseIds, { poll: PRESENCE_POLL_MS })
  return { students: rows, ...state }
}

export function useTeacherStudentVisits(courseIds: string[] | null) {
  const { rows, ...state } = useActivityRows<WeeklyStudent>('teacher_student_visits', courseIds)
  return { students: rows, ...state }
}

export function useTeacherHomeworkSubmissions(courseIds: string[] | null, asOf: string) {
  return useActivityRows<HomeworkSubmission>('teacher_homework_submissions_today', courseIds, { asOf })
}
