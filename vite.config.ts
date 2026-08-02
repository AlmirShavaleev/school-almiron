import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Тяжёлые зависимости, которые встречаются ТОЛЬКО в лениво загружаемых
 * страницах. При старте dev-сервера Vite сканирует граф импортов от index.html
 * и такие пакеты не находит — они всплывают позже, когда пользователь дошёл до
 * страницы. Тогда Vite пересобирает пакеты на лету и **перезагружает вкладку**:
 * снаружи это выглядит как «открыл проект, висит спиннер, помогает только F5».
 * Перечисляем их явно, чтобы всё пересборка случилась один раз при запуске
 * сервера, а не посреди первой загрузки.
 *
 * На прод-сборку список не влияет — это только преоптимизация в dev.
 */
const HEAVY_LAZY_DEPS = [
  'recharts',
  'xlsx',
  'pdfjs-dist',
  'framer-motion',
  'dompurify',
  'date-fns',
  'date-fns/locale',
  'react-hook-form',
  'zod',
  '@hookform/resolvers/zod',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
]

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: HEAVY_LAZY_DEPS,
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    strictPort: false,
    // Прогрев: сервер начинает трансформировать вход и защищённое поддерево, не
    // дожидаясь запроса от браузера. Первая загрузка перестаёт упираться в
    // очередь трансформаций — в dev каждый файл едет отдельным запросом.
    warmup: {
      clientFiles: ['./index.html', './src/main.tsx', './src/App.tsx', './src/AppRoutes.tsx'],
    },
  },
})
