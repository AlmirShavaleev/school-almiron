import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { EyeOff, Users } from 'lucide-react'
import { usePreviewMode } from '@/store/staffModeStore'

/**
 * Честная заглушка для ученических страниц, которые в предпросмотре (§178)
 * показать нельзя: их данные — личные данные ученика (`auth_student_id()`:
 * ДЗ, прогресс, варианты, уведомления). У владельца таких строк нет, и
 * пустой список читался бы как «у учеников пусто». Вместо этого — объяснение
 * и ссылка на карточку ученика (§171), где всё это видно по-настоящему.
 */
export function StudentPreviewUnavailable() {
  return (
    <div
      data-testid="student-preview-unavailable"
      className="mx-auto mt-10 max-w-lg space-y-4 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-6 py-8 text-center"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
        <EyeOff size={22} />
      </div>
      <h2 className="text-lg font-bold text-graphite-950">В предпросмотре недоступно</h2>
      <p className="text-sm text-amber-900">
        Здесь личные данные ученика: его работы, ответы и прогресс. У предпросмотра
        их нет — откройте карточку ученика.
      </p>
      <Link
        to="/students"
        className="inline-flex items-center gap-2 rounded-lg bg-primary-950 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-900"
      >
        <Users size={15} />
        Карточка ученика
      </Link>
    </div>
  )
}

/**
 * Маршрут, открытый всем ролям, но в предпросмотре показывающий заглушку:
 * например, «Уведомления» — у владельца они свои, а не ученические, и
 * показывать их под ярлыком «Ученик» было бы обманом.
 */
export function PreviewStubGate({ children }: { children: ReactNode }) {
  const preview = usePreviewMode()
  if (preview) return <StudentPreviewUnavailable />
  return <>{children}</>
}
