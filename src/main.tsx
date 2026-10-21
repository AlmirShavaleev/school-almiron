// Первым импортом и не «заодно»: pdf.js 6.1 зовёт Map.prototype.getOrInsertComputed
// прямо на пути render(), а этого метода нет ни в одном браузере — без строки
// ниже ни одна страница PDF в приложении не рисуется. Подробности — в модуле.
import './lib/pdfjsCompat'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { installCatalogMathObserver } from './lib/katexLoader'
import { stripBustParam } from './lib/lazyPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// После автоперезагрузки за свежим index.html (lazyPage, 21.10) — убрать ?_r= из адреса.
stripBustParam()

// §269: формулы каталога (KaTeX грузится лениво) — дорисовка везде, где бы HTML задачи ни оказался.
installCatalogMathObserver()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
