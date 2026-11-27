import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CatalogLockedNotice } from '@/components/catalog/CatalogLockedNotice'
import { Button } from '@/components/ui/Button'
import { DIRECTIONS } from '@/hooks/useCatalog'
import { useCatalogDirections } from '@/hooks/useCatalogDirections'
import { useAuthStore } from '@/store/authStore'

const EGE_DIRECTIONS = DIRECTIONS.filter(direction => direction.examSlug === 'ege')

export function CatalogHome() {
  const role = useAuthStore(state => state.profile?.role)

  return (
    <div className="mx-auto grid max-w-[1100px] gap-4" data-testid="catalog-home">
      <h1 className="text-2xl font-bold text-graphite-950">Каталог заданий</h1>
      {role && (role === 'student' ? <StudentCatalogDirections /> : <DirectionLinks directions={EGE_DIRECTIONS} />)}
    </div>
  )
}

function StudentCatalogDirections() {
  const { directions, loading, error, retry } = useCatalogDirections()
  if (loading) return <p role="status" className="text-sm text-graphite-600">Загружаю направления…</p>
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" data-testid="catalog-home-error" className="text-sm text-graphite-700">Не удалось загрузить доступные направления.</p>
        <Button variant="secondary" onClick={() => { void retry() }}>Повторить</Button>
      </div>
    )
  }
  if (!directions) return null

  const available = EGE_DIRECTIONS.filter(direction => directions.includes(`${direction.subject}|${direction.examType}`))
  return available.length ? <DirectionLinks directions={available} /> : <CatalogLockedNotice whole />
}

function DirectionLinks({ directions }: { directions: typeof EGE_DIRECTIONS }) {
  return (
    <nav aria-label="Направления каталога" className="flex flex-wrap gap-2.5">
      {directions.map(direction => (
        <Link
          key={direction.key}
          to={`/catalog?subject=${direction.subjectSlug}&exam=${direction.examSlug}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-graphite-200 bg-white px-4 py-2 text-sm font-semibold text-graphite-950 transition-colors hover:border-primary-400 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {direction.label} <ChevronRight size={16} className="text-primary-600" aria-hidden />
        </Link>
      ))}
    </nav>
  )
}
