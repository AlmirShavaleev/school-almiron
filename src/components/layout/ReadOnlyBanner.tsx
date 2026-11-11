import { Wrench } from 'lucide-react'
import { READ_ONLY_MODE, READ_ONLY_MESSAGE } from '@/lib/readOnlyMode'

/**
 * Полоса «технические работы» на время режима только просмотра
 * (src/lib/readOnlyMode.ts). Видна всем на каждой странице кабинета.
 */
export function ReadOnlyBanner() {
  if (!READ_ONLY_MODE) return null
  return (
    <div
      role="status"
      data-testid="read-only-banner"
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 md:px-8"
    >
      <Wrench size={16} className="shrink-0 text-amber-700" aria-hidden />
      <span>{READ_ONLY_MESSAGE}</span>
    </div>
  )
}
