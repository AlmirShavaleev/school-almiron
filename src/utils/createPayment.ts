import { READ_ONLY_MODE } from '@/lib/readOnlyMode'
import { supabase } from '@/lib/supabase'

interface CreatePaymentArgs {
  plan_id:     string
  student_id:  string
  profile_id:  string
  save_method: boolean
  description?: string
}

interface CreatePaymentResult {
  confirmation_url: string
  payment_id:       string
  db_payment_id?:   string
}

export async function createPayment(args: CreatePaymentArgs): Promise<CreatePaymentResult> {
  if (READ_ONLY_MODE) throw new Error('Оплата временно недоступна: на платформе идут технические работы.')
  const { data, error } = await supabase.functions.invoke('create-payment', {
    body: args,
  })

  if (error) throw new Error(error.message || 'Ошибка создания платежа')
  if (data?.error) throw new Error(data.error)
  if (!data?.confirmation_url) throw new Error('Не получена ссылка для оплаты')

  return data as CreatePaymentResult
}
