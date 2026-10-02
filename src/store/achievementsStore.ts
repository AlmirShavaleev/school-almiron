import { create } from 'zustand'

/**
 * §257. Сколько новых (не просмотренных) наград — для счётчика у пункта меню
 * «Достижения». Меню читает число из базы при входе (`student_achievements`,
 * `seen_at is null`), а sync на главной и mark_achievements_seen на странице
 * «Достижения» обновляют его сразу, без перезагрузки меню.
 * null — ещё никто не сообщал (меню верит своему запросу).
 */
interface AchievementsBadgeState {
  newCount: number | null
  setNewCount: (n: number | null) => void
}

export const useAchievementsBadge = create<AchievementsBadgeState>(set => ({
  newCount: null,
  setNewCount: n => set({ newCount: n }),
}))
