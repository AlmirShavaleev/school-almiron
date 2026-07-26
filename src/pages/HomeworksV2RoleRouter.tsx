import { useAuthStore } from '@/store/authStore'
import { MyHomeworksV2Page } from '@/pages/student/MyHomeworksV2Page'
import { HomeworkReviewV2Page } from '@/pages/HomeworkReviewV2Page'

/** /homeworks is role-branched: students manage their own submissions, staff review the
 * group's queue. Canonical aliases /my-homeworks and /homework-review point at the same
 * two pages directly. */
export function HomeworksV2RoleRouter() {
  const role = useAuthStore(s => s.profile?.role)
  if (role === 'student') return <MyHomeworksV2Page />
  return <HomeworkReviewV2Page />
}
