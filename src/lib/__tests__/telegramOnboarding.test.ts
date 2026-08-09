import { beforeEach, describe, expect, it } from 'vitest'
import type { UserRole } from '@/types'
import {
  TELEGRAM_PROMPT_ROLES,
  telegramBenefit,
  telegramPromptFor,
} from '../telegramOnboarding'
import { useTelegramOnboardingStore } from '@/store/telegramOnboardingStore'

describe('telegramPromptFor — что показать', () => {
  it('непривязанному показываем карточку', () => {
    expect(telegramPromptFor('student', false, false)).toBe('card')
  })

  it('после «позже» — только полоска, карточка больше не лезет', () => {
    expect(telegramPromptFor('student', false, true)).toBe('strip')
  })

  it('привязанному не показываем ничего — ни до отказа, ни после', () => {
    expect(telegramPromptFor('student', true, false)).toBeNull()
    expect(telegramPromptFor('student', true, true)).toBeNull()
  })

  it('роли без уведомлений не зовём', () => {
    // Родителю в контуре не адресовано ни одно событие: предлагать канал,
    // по которому ничего не придёт, нечестно.
    // 'parent' есть в user_role базы, но не в клиентском UserRole — приведение
    // намеренное: проверяем именно поведение на роли вне списка.
    expect(telegramPromptFor('parent' as UserRole, false, false)).toBeNull()
    expect(telegramPromptFor(null, false, false)).toBeNull()
    expect(telegramPromptFor(undefined, false, false)).toBeNull()
  })

  it.each(TELEGRAM_PROMPT_ROLES)('роль %s получает приглашение', (role) => {
    expect(telegramPromptFor(role, false, false)).toBe('card')
  })
})

describe('telegramBenefit — выгода своими словами', () => {
  it('ученику про задания и оценки, на «ты»', () => {
    const { title, body } = telegramBenefit('student')
    expect(title).toContain('Привяжи')
    expect(body).toMatch(/задани|оценк/i)
  })

  it('персоналу про сдачи, на «вы»', () => {
    const { title, body } = telegramBenefit('teacher')
    expect(title).toContain('Привяжите')
    expect(body).toMatch(/сдач/i)
  })

  it('формулировки у ученика и у персонала разные', () => {
    expect(telegramBenefit('student').body).not.toBe(telegramBenefit('teacher').body)
  })
})

describe('отказ «позже» — на profile_id', () => {
  beforeEach(() => {
    localStorage.clear()
    useTelegramOnboardingStore.setState({ dismissed: false, profileId: null })
  })

  it('отказ одного не молчит за другого на той же машине', () => {
    const store = useTelegramOnboardingStore.getState()

    store.hydrate('profile-A')
    useTelegramOnboardingStore.getState().dismiss()
    expect(useTelegramOnboardingStore.getState().dismissed).toBe(true)

    useTelegramOnboardingStore.getState().hydrate('profile-B')
    expect(useTelegramOnboardingStore.getState().dismissed).toBe(false)

    useTelegramOnboardingStore.getState().hydrate('profile-A')
    expect(useTelegramOnboardingStore.getState().dismissed).toBe(true)
  })

  it('отказ переживает перезагрузку: он в localStorage, а не в памяти', () => {
    useTelegramOnboardingStore.getState().hydrate('profile-A')
    useTelegramOnboardingStore.getState().dismiss()

    // новый сеанс стора — как после F5
    useTelegramOnboardingStore.setState({ dismissed: false, profileId: null })
    useTelegramOnboardingStore.getState().hydrate('profile-A')

    expect(useTelegramOnboardingStore.getState().dismissed).toBe(true)
  })

  it('без профиля отказ не запоминается', () => {
    useTelegramOnboardingStore.getState().hydrate(null)
    useTelegramOnboardingStore.getState().dismiss()
    expect(localStorage.length).toBe(0)
  })
})
