import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthStore } from '@/store/authStore'
import { LoadingGate } from '@/components/shared/LoadingGate'
import { useMyCuratorships } from '@/hooks/useMyCuratorships'
import { usePreviewMode } from '@/store/staffModeStore'
import { StudentPreviewUnavailable } from '@/components/layout/StudentPreviewUnavailable'
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
 *
 * `preview` — третья дверь, для предпросмотра «глазами ученика» (§178), и
 * только для ученических маршрутов, где она проставлена явно:
 *  · `'allow'` — admin/owner в режиме предпросмотра проходят на страницу
 *    (список курсов, курс, тема): их данные страница берёт из staff-источников;
 *  · `'stub'` — в предпросмотре вместо страницы честная заглушка: здесь
 *    личные данные ученика, которых у владельца нет и быть не должно.
 * Без `preview` режим предпросмотра на охрану не влияет вовсе — настоящая
 * роль из профиля, как и раньше.
 */
export function RoleGuard({
  allow,
  allowCourseCurator = false,
  preview,
  children,
}: {
  allow: UserRole[]
  allowCourseCurator?: boolean
  preview?: 'allow' | 'stub'
  children: ReactNode
}) {
  const profile = useAuthStore(s => s.profile)
  const loading = useAuthStore(s => s.loading)
  const curatorships = useMyCuratorships()
  const inPreview = usePreviewMode()

  const roleAllowed = profile != null && allow.includes(profile.role)
  // Спрашиваем про кураторство, только если по роли не пустили: обычному
  // преподавателю ждать ответа таблицы незачем.
  const waitingForCuratorship = allowCourseCurator && !roleAllowed && curatorships.loading

  // Ждём профиль (или ответ о кураторстве) с пределом по времени: если ответ
  // не придёт, страница обязана сказать об этом и предложить обновить, а не
  // крутить кружок бесконечно. См. `LoadingGate`.
  if ((loading && !profile) || waitingForCuratorship) {
    return <LoadingGate label="проверка доступа" />
  }
  if (!profile) return <Navigate to="/login" replace />
  // `inPreview` истинно только у admin/owner (`isPreviewMode`), поэтому
  // ученику и преподавателю эти две ветки недостижимы по построению.
  if (inPreview && preview === 'stub') return <StudentPreviewUnavailable />
  if (inPreview && preview === 'allow') return <>{children}</>
  if (!roleAllowed && !(allowCourseCurator && curatorships.isCurator)) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
