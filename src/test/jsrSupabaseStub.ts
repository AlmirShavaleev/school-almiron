// §247. Подмена `jsr:@supabase/supabase-js@2` для vitest (алиас в vitest.config.ts):
// edge-функцию check-homework-ai гоняют на записывающей заглушке.
export { fakeCreateClient as createClient } from './checkHomeworkAiHarness'
