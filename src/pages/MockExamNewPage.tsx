import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { MockExamForm } from '@/components/mockExams/MockExamForm'

/**
 * §228. «Новый пробник» — одна форма (экран 1 макета `МАКЕТ-ПРОБНИК-V3.html`)
 * вместо модалки §218 и отдельной настройки §221. `?group=` подставляет
 * группу — так открывает форму раздел «Пробники» программы курса (§224).
 */
export function MockExamNewPage() {
  const [params] = useSearchParams()
  return (
    <div className="space-y-4" data-testid="mock-new-page">
      <Link to="/mock-exams" className="inline-flex items-center gap-1 text-[13px] text-graphite-500 hover:text-primary-700"><ArrowLeft size={13} aria-hidden />Пробники</Link>
      <h1 className="text-2xl font-semibold text-graphite-900 sm:text-[26px]">Новый пробник</h1>
      <MockExamForm mode={{ kind: 'create', defaultGroupId: params.get('group') }} />
    </div>
  )
}
