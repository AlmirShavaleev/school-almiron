import { Star } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { AchievementCategory, Tier } from '@/lib/achievements'
import { CATEGORY_ICON, TIER_STYLE } from './achievementStyle'

/**
 * §257. Медаль награды: значок категории в круге цвета уровня (бронза,
 * серебро, золото, легенда — как в макете), неполученная — серая.
 * Цвет — не единственный признак: рядом всегда подпись и «получено» / «N из M».
 */
export function AchievementMedal({ category, tier, locked = false, size = 50, className }: {
  category: AchievementCategory
  tier: Tier
  locked?: boolean
  size?: number
  className?: string
}) {
  const Icon = CATEGORY_ICON[category] ?? Star
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full', locked ? 'bg-graphite-100 text-graphite-300' : TIER_STYLE[tier].medal, className)}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  )
}
