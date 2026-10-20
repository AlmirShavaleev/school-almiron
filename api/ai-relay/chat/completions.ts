/**
 * POST /api/ai-relay/chat/completions → https://openrouter.ai/api/v1/chat/completions.
 * Ретранслятор для ИИ-функций с нашего сервера в РФ (письмо 20.10): правила и
 * границы — в `api/_lib/aiRelay.ts`. Секрет — env `AI_RELAY_SECRET` (Production).
 * Длительность — `maxDuration` в vercel.json (модель отвечает до 120 с).
 */
import { handleRelay } from '../../_lib/aiRelay.js'

export async function POST(request: Request): Promise<Response> {
  return handleRelay(request, process.env.AI_RELAY_SECRET)
}
