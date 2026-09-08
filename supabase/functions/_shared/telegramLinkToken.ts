/**
 * Общие мелочи для одноразовых токенов привязки Telegram: срок жизни и
 * хэширование. Сам токен — случайные байты, как и был; хэш общий, потому что
 * его считает и generate-telegram-link (при выдаче), и telegram-bot-webhook
 * (при проверке пришедшей от Telegram строки) — раньше это было two copies.
 */

/** Час вместо пятнадцати минут — единственное место, где живёт этот срок. */
export const TOKEN_TTL_MS = 60 * 60 * 1000

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
