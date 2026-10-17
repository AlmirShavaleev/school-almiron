/**
 * Лендинг v3 — отдельно от выкатки ЛК (письмо ЛК_выкатка_без_нового_лендинга.md,
 * 17.10: «лендинг отдельно, чтобы ученики пока его не видели»).
 *
 * Флаг сборки `VITE_LANDING_V3` (1/true — включён; по умолчанию выключен, в
 * Vercel не ставится). Выключен — публичные страницы как в main: гость на `/` —
 * на вход, `/about` — прежний лендинг. Включён — гость на `/` и `/about` видит
 * v3. Владелец смотрит v3 всегда по скрытому адресу `/preview/landing` (noindex).
 * Функция, а не константа: тест переключает флаг через `vi.stubEnv`.
 */
export function landingV3Enabled(): boolean {
  const v = String(import.meta.env.VITE_LANDING_V3 ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

export const LANDING_PREVIEW_PATH = '/preview/landing'
