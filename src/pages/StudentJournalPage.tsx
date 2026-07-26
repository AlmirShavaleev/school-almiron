import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { JournalView } from '@/components/journal/JournalView'

export function StudentJournalPage() {
  const { studentId } = useParams<{ studentId: string }>()
  const navigate = useNavigate()

  if (!studentId) return null

  return (
    <div className="space-y-4 max-w-4xl">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft size={16} />Назад
      </button>

      <JournalView
        studentId={studentId}
        viewerRole="teacher"
        lessonHref={lessonId => `/lessons/${lessonId}`}
      />
    </div>
  )
}
