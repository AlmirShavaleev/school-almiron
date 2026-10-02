import {
  AlarmClock, BookOpen, ClipboardCheck, FileText, Flag, Flame, LayoutList, ListChecks, RotateCcw, Sparkles,
  Sprout, Star, Sun, Target, TrendingUp, Trophy, type LucideIcon,
} from 'lucide-react'
import type { AchievementCategory, Tier } from '@/lib/achievements'

/** §257. Значок категории награды и цвета уровней (бронза, серебро, золото, легенда — как в макете). */
export const CATEGORY_ICON: Record<AchievementCategory, LucideIcon> = {
  catalog: LayoutList,
  hw: ClipboardCheck,
  ontime: AlarmClock,
  five: Star,
  mock: FileText,
  mockscore: Trophy,
  streak: Flame,
  daily: Sun,
  weekly: Flag,
  confident: Target,
  closed: Sprout,
  forecast: TrendingUp,
  tests: ListChecks,
  topics: BookOpen,
  redo: RotateCcw,
  special: Sparkles,
}

/** Заливка и цвет значка по уровню (значения макета; текст на заливке ≥ 4.5:1). */
export const TIER_STYLE: Record<Tier, { medal: string; dot: string; ink: string }> = {
  1: { medal: 'bg-[#f7e9dd] text-[#9a5a26]', dot: 'bg-[#b06f3a]', ink: 'text-[#8a4f20]' },
  2: { medal: 'bg-[#e9eef5] text-[#55657c]', dot: 'bg-[#6b7a90]', ink: 'text-[#4a5a70]' },
  3: { medal: 'bg-gold-100 text-gold-600', dot: 'bg-gold-500', ink: 'text-gold-700' },
  4: { medal: 'bg-[#efe8fd] text-[#6d3fd6]', dot: 'bg-[#6d3fd6]', ink: 'text-[#5a2fc0]' },
}
