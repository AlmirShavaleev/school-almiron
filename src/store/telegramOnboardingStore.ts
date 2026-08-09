import { create } from 'zustand'
import { useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Отметка «этот человек уже сказал „позже“».
 *
 * Ключ на profile_id — как в `staffModeStore` (§73/§76): на одной машине
 * входят разные люди, и отказ одного не должен молчать за другого.
 *
 * Почему localStorage, а не sessionStorage: отказ обязан пережить выход и
 * вход. Иначе «позже» превращается в «до следующего входа», и заметная
 * карточка встречает человека каждый раз — ровно та стена, которую просили не
 * строить. Полоска-напоминание при этом остаётся: забыть про непривязанный
 * Telegram мы тоже не должны.
 */
const DISMISS_PREFIX = 'almiron:tg-onboarding-dismissed:'

function readDismissed(profileId: string): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + profileId) === '1'
  } catch {
    // Хранилище недоступно (приватный режим, запрет) — считаем, что не
    // отказывались. Карточка покажется лишний раз; это безопаснее, чем
    // молча спрятать единственное приглашение.
    return false
  }
}

function writeDismissed(profileId: string): void {
  try {
    localStorage.setItem(DISMISS_PREFIX + profileId, '1')
  } catch {
    /* см. readDismissed */
  }
}

interface TelegramOnboardingState {
  dismissed: boolean
  profileId: string | null
  dismiss:   () => void
  hydrate:   (profileId: string | null) => void
}

export const useTelegramOnboardingStore = create<TelegramOnboardingState>()((set, get) => ({
  dismissed: false,
  profileId: null,
  dismiss: () => {
    const { profileId } = get()
    if (profileId) writeDismissed(profileId)
    set({ dismissed: true })
  },
  hydrate: (profileId) => {
    if (get().profileId === profileId) return
    set({
      profileId,
      dismissed: profileId ? readDismissed(profileId) : false,
    })
  },
}))

/** Единственная точка, из которой интерфейс берёт «отказывался ли он». */
export function useTelegramOnboardingDismissed() {
  const profile   = useAuthStore(s => s.profile)
  const dismissed = useTelegramOnboardingStore(s => s.dismissed)
  const dismiss   = useTelegramOnboardingStore(s => s.dismiss)
  const hydrate   = useTelegramOnboardingStore(s => s.hydrate)

  useEffect(() => {
    hydrate(profile?.id ?? null)
  }, [profile?.id, hydrate])

  return { dismissed, dismiss }
}
