/**
 * CatalogTaskPage — прямой доступ к задаче по UUID.
 *
 * URL: /catalog/task/:taskId
 *
 * Открывает любую задачу каталога без привязки к теме.
 * Для ролей teacher/admin/owner/curator показывает служебную метку
 * «Тема не назначена», если у задачи нет topic-связи.
 */

import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, BookOpen, AlertCircle } from 'lucide-react'

import {
  useCatalogTask,
  SUBJECT_SLUGS,
} from '@/hooks/useCatalog'
import { useAuthStore } from '@/store/authStore'
import { AddToCartButton } from '@/components/catalog/AddToCartButton'
import { CartBadge } from '@/components/catalog/CartBadge'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'

const STAFF_ROLES = new Set(['teacher', 'curator', 'admin', 'owner'])

export function CatalogTaskPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const [searchParams] = useSearchParams()
  const { profile } = useAuthStore()
  const { task, loading, error } = useCatalogTask(taskId)

  const subjectSlug = searchParams.get('subject') ?? (task?.section ? (SUBJECT_SLUGS[task.section.subject] ?? 'math') : 'math')
  const examSlug    = searchParams.get('exam')    ?? 'ege'

  if (loading) return <TaskSkeleton />
  if (error || !task) return <ErrorState message={error ?? 'Задача не найдена'} />

  const isStaff = profile && STAFF_ROLES.has(profile.role)
  const showNoTopicBadge = isStaff && !task.hasTopicAssigned

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
        <Link to={`/catalog?subject=${subjectSlug}&exam=${examSlug}`} className="hover:text-primary-600">
          Каталог
        </Link>
        <ChevronLeft className="w-3 h-3 rotate-180" />
        {task.section && (
          <>
            <Link
              to={`/catalog/${task.section_id}?subject=${subjectSlug}&exam=${examSlug}`}
              className="hover:text-primary-600"
            >
              {task.section.title}
            </Link>
            <ChevronLeft className="w-3 h-3 rotate-180" />
          </>
        )}
        <span className="text-gray-700">Задача #{task.external_id}</span>
      </nav>

      {/* Admin-only: no-topic badge */}
      {showNoTopicBadge && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs"
          data-testid="no-topic-badge"
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          Тема не назначена
        </div>
      )}

      {/* Add to cart — staff only */}
      {isStaff && (
        <div className="flex justify-end">
          <AddToCartButton taskId={task.id} />
        </div>
      )}

      {/* Task card */}
      <TaskDisplayCard task={task} />

      <CartBadge />
    </div>
  )
}

// ── Skeletons / error states ──────────────────────────────────────────────────

function TaskSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-48" />
      <div className="bg-gray-100 rounded-xl h-48" />
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center">
      <BookOpen className="w-12 h-12 text-gray-300 mx-auto mb-3" />
      <p className="text-red-600 font-medium">Ошибка загрузки</p>
      <p className="text-gray-500 text-sm mt-1">{message}</p>
    </div>
  )
}
