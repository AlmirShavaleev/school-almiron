import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { useToastStore } from '@/store/toastStore'
import { cn } from '@/utils/cn'

const CONFIG = {
  success: { icon: <CheckCircle2 size={16} />, cls: 'bg-green-50 border-green-200 text-green-800' },
  error:   { icon: <AlertCircle   size={16} />, cls: 'bg-red-50   border-red-200   text-red-800'   },
  warning: { icon: <AlertTriangle size={16} />, cls: 'bg-amber-50  border-amber-200  text-amber-800' },
  info:    { icon: <Info          size={16} />, cls: 'bg-blue-50  border-blue-200  text-blue-800'  },
}

export function Toaster() {
  const { toasts, remove } = useToastStore()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const cfg = CONFIG[t.type]
        return (
          <div
            key={t.id}
            className={cn(
              'flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg max-w-sm pointer-events-auto',
              'animate-in slide-in-from-bottom-2 duration-200',
              cfg.cls,
            )}
          >
            <span className="shrink-0 mt-0.5">{cfg.icon}</span>
            <p className="flex-1 text-sm font-medium leading-snug">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
