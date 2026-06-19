import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, LogOut, Loader2 } from 'lucide-react'
import { impersonatingLabel, returnToAdmin } from '@/lib/demo'

/** Баннер режима impersonation: «Вы работаете как …» + возврат в админа. */
export function ImpersonationBanner() {
  const navigate = useNavigate()
  const [label, setLabel] = useState<string | null>(impersonatingLabel())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setLabel(impersonatingLabel())
    window.addEventListener('demo:change', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('demo:change', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (!label) return null

  async function back() {
    setBusy(true)
    try {
      await returnToAdmin()
      navigate('/dashboard')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-amber-500 text-white px-4 md:px-8 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye size={15} className="shrink-0" />
        <span className="truncate">Вы работаете как <strong>{label}</strong> (демо-режим)</span>
      </div>
      <button
        onClick={back}
        disabled={busy}
        className="shrink-0 flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
        Вернуться в аккаунт администратора
      </button>
    </div>
  )
}
