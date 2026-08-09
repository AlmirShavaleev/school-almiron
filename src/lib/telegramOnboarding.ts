import type { UserRole } from '@/types'

/**
 * Кому предлагаем привязать Telegram.
 *
 * Родитель не в списке: событий, адресованных родителю, в контуре нет ни
 * одного — предлагать ему канал, по которому ничего не придёт, нечестно.
 * Владелец в списке, хотя формально не назван в задании: он получает
 * обращения «Сообщить о проблеме» и сдачи по своим курсам, то есть канал ему
 * нужен ровно так же, как админу.
 */
export const TELEGRAM_PROMPT_ROLES: UserRole[] = [
  'student', 'teacher', 'curator', 'admin', 'owner',
]

/**
 * Что показать: заметную карточку, тихую полоску или ничего.
 *
 * Правило владельца: «Позже» должно работать. Один раз отказался — больше не
 * загораживаем кабинет, но и не забываем: полоска висит, пока не привязано.
 * Привязал — не показываем ничего и никогда.
 */
export type TelegramPrompt = 'card' | 'strip' | null

export function telegramPromptFor(
  role:      UserRole | null | undefined,
  linked:    boolean,
  dismissed: boolean,
): TelegramPrompt {
  if (!role || !TELEGRAM_PROMPT_ROLES.includes(role)) return null
  if (linked) return null
  return dismissed ? 'strip' : 'card'
}

/**
 * Выгода своими словами и для своей роли. Ученику важно не пропустить работу и
 * оценку, персоналу — узнать о сдаче вовремя. Общая формулировка «включите
 * уведомления» не говорит ни тому, ни другому, зачем это ему.
 */
export function telegramBenefit(role: UserRole | null | undefined): {
  title: string
  body:  string
} {
  if (role === 'student') {
    return {
      title: 'Привяжи Telegram',
      body:  'Будешь сразу узнавать о новых домашних заданиях, оценках и переносах занятий.',
    }
  }
  return {
    title: 'Привяжите Telegram',
    body:  'Сдачи учеников и сообщения о проблемах будут приходить сразу, без захода в кабинет.',
  }
}
