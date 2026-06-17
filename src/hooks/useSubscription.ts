import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export interface Plan {
  id:              string
  name:            string
  description:     string | null
  price:           number
  currency:        string
  billing_period:  'once' | 'month' | 'year'
  trial_days:      number
  features:        string[]
  is_active:       boolean
  sort_order:      number
}

export interface Subscription {
  id:                          string
  student_id:                  string
  plan_id:                     string
  status:                      'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | 'pending'
  current_period_start:        string | null
  current_period_end:          string | null
  cancel_at_period_end:        boolean
  yookassa_payment_method_id:  string | null
  created_at:                  string
  plans:                       Plan | null
}

export function usePlans() {
  const [plans, setPlans]   = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setPlans((data || []).map((p: any) => ({
          ...p,
          features: Array.isArray(p.features) ? p.features : [],
        })))
        setLoading(false)
      })
  }, [])

  return { plans, loading }
}

export function useSubscription() {
  const profile = useAuthStore(s => s.profile)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [studentId,    setStudentId]    = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [tick, setTick]                 = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || profile.role !== 'student') {
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      // Get student id
      const { data: st } = await supabase
        .from('students').select('id').eq('profile_id', profile!.id).single()

      if (!st) { setLoading(false); return }
      setStudentId(st.id)

      // Get active subscription
      const { data } = await supabase
        .from('subscriptions')
        .select('*, plans(*)')
        .eq('student_id', st.id)
        .in('status', ['active', 'trial', 'past_due'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      setSubscription((data || null) as any)
      setLoading(false)
    }
    load()
  }, [profile, tick])

  async function cancelSubscription() {
    if (!subscription) return
    await supabase
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('id', subscription.id)
    reload()
  }

  async function reactivateSubscription() {
    if (!subscription) return
    await supabase
      .from('subscriptions')
      .update({ cancel_at_period_end: false })
      .eq('id', subscription.id)
    reload()
  }

  return { subscription, studentId, loading, reload, cancelSubscription, reactivateSubscription }
}
