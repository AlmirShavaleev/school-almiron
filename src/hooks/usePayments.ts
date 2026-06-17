import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface Payment {
  id:                   string
  student_id:           string | null
  subscription_id:      string | null
  plan_id:              string | null
  amount:               number
  currency:             string
  status:               'pending' | 'succeeded' | 'cancelled' | 'refunded' | 'waiting_for_capture'
  yookassa_payment_id:  string | null
  confirmation_url:     string | null
  description:          string | null
  is_recurring:         boolean
  paid_at:              string | null
  created_at:           string
  plans:                { name: string; billing_period: string } | null
  students:             { profiles: { full_name: string } } | null
}

export function usePayments() {
  const profile = useAuthStore(s => s.profile)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading]   = useState(true)
  const [tick, setTick]         = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    setLoading(true)

    async function load() {
      try {
        const role = profile!.role

        if (role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!st) return
          const { data } = await supabase
            .from('payments')
            .select('*, plans(name, billing_period)')
            .eq('student_id', st.id)
            .order('created_at', { ascending: false })
            .limit(50)
          setPayments((data || []) as any)

        } else if (role === 'parent') {
          const { data: par } = await (supabase as any)
            .from('parents').select('id').eq('profile_id', profile!.id).single()
          if (!par) return
          const { data: ps } = await (supabase as any)
            .from('parent_students').select('student_id').eq('parent_id', par.id)
          const ids = (ps || []).map((p: any) => p.student_id)
          if (!ids.length) { setPayments([]); return }
          const { data } = await supabase
            .from('payments')
            .select('*, plans(name, billing_period), students(profiles(full_name))')
            .in('student_id', ids)
            .order('created_at', { ascending: false })
            .limit(50)
          setPayments((data || []) as any)

        } else {
          // admin / owner — все платежи
          const { data } = await supabase
            .from('payments')
            .select('*, plans(name, billing_period), students(profiles(full_name))')
            .order('created_at', { ascending: false })
            .limit(200)
          setPayments((data || []) as any)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [profile, tick])

  return { payments, loading, reload }
}
