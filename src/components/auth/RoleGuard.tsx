import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import type { UserRole } from '@/types'

/**
 * Защита маршрута по роли. Роль берётся ТОЛЬКО из загруженного из БД профиля.
 * Если роль не входит в allow — редирект на собственный дашборд пользователя.
 *
 * `allowCourseCurator` — вторая, не-ролевая дверь: с 2026-08-05 кураторство
 * это назначение поверх аккаунта (`course_curators`), и ученик, курирующий
 * чужой курс, обязан попасть на страницы проверки ДЗ, программы и учеников,
 * оставаясь в профиле учеником. Спрашивать про это `profile.role` бесполезно
 * — там по-прежнему `student`.
 *
 * Дверь только открывает страницу. ДАННЫЕ на ней всё равно раздаёт RLS через
 * `course_is_staff`, а сужает `useMyTeachingScope`: попасть на страницу и
 * увидеть на ней чужое — разные вещи.
 */
export function RoleGuard({
  allow,
  allowCourseCurator = false,
  children,
}: {
  allow: UserRole[]
  allowCourseCurator?: boolean
  children: ReactNode
}) {
  const profile = useAuthStore(s => s.profile)
  const loading = useAuthStore(s => s.loading)
  const curatorships = useMyCuratorships()

  const roleAllowed = profile != null && allow.includes(profile.role)
  // Спрашиваем про кураторство, только если по роли не пустили: обычному
  // преподавателю ждать ответа таблицы незачем.
  const waitingForCuratorship = allowCourseCurator && !roleAllowed && curatorships.loading

  if ((loading && !profile) || waitingForCuratorship) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!profile) return <Navigate to="/login" replace />
  if (!roleAllowed && !(allowCourseCurator && curatorships.isCurator)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
