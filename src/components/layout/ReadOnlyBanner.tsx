import { ShieldAlert } from 'lucide-react'
import { READ_ONLY_MODE, READ_ONLY_NOTICE } from '@/lib/readOnlyMode'

/**
 * Объявление «технические работы» на время режима только просмотра
 * (src/lib/readOnlyMode.ts). В кабинете — полоса под шапкой на каждой
 * странице; на странице входа (`variant="card"`) — карточка над формой.
 */
export function ReadOnlyBanner({ variant = 'strip' }: { variant?: 'strip' | 'card' }) {
  if (!READ_ONLY_MODE) return null
  const box = variant === 'card'
    ? 'mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-left shadow-sm'
    : 'border-b border-amber-300 bg-amber-50 px-4 py-3 md:px-8'
  return (
    <div role="status" data-testid="read-only-banner" className={`${box} text-sm text-amber-950`}>
      <div className="flex items-start gap-2.5">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
        <div className="space-y-0.5">
          <div className="font-semibold">{READ_ONLY_NOTICE.title}</div>
          {READ_ONLY_NOTICE.lines.map(line => <p key={line}>{line}</p>)}
        </div>
      </div>
    </div>
  )
}
