/**
 * Шкалы ЕГЭ и даты экзамена живут в общем модуле фронта и Edge Functions —
 * `supabase/functions/_shared/egeScales.ts` (ночной расчёт прогноза, письмо
 * 16.10). Здесь — только вход для фронта, чтобы импорты `@/lib/egeScales` не менялись.
 */
export * from '../../supabase/functions/_shared/egeScales.ts'
