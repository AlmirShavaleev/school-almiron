import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // §247. Deno-импорт edge-функции check-homework-ai: в vitest вместо
      // настоящего клиента — записывающая заглушка (src/test/checkHomeworkAiHarness.ts).
      'jsr:@supabase/supabase-js@2': path.resolve(__dirname, './src/test/jsrSupabaseStub.ts'),
      // Рендер PDF в тестах не гоняется (работы — фотографии); импорт должен лишь разрешиться.
      'npm:@hyzyla/pdfium@2.1.13': path.resolve(__dirname, './src/test/denoNpmStub.ts'),
      'npm:jpeg-js@0.4.4': path.resolve(__dirname, './src/test/denoNpmStub.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
