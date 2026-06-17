// Webhook заготовки для интеграции с n8n / Telegram

const WEBHOOK_BASE = import.meta.env.VITE_WEBHOOK_BASE_URL || '/api/webhooks'

async function sendWebhook(event: string, payload: Record<string, unknown>) {
  try {
    const res = await fetch(`${WEBHOOK_BASE}/${event}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload }),
    })
    return { success: res.ok }
  } catch (e) {
    console.warn(`Webhook ${event} failed (offline mode):`, e)
    return { success: false }
  }
}

export const webhooks = {
  // Напомнить ученику о ДЗ
  remindStudent: (studentId: string, homeworkTitle: string, dueDate: string) =>
    sendWebhook('remind-student', { studentId, homeworkTitle, dueDate }),

  // Уведомить о просроченном ДЗ
  notifyOverdueHomework: (studentId: string, homeworkId: string) =>
    sendWebhook('overdue-homework', { studentId, homeworkId }),

  // Уведомить о пропуске занятия
  notifyAbsence: (studentId: string, lessonId: string, date: string) =>
    sendWebhook('student-absence', { studentId, lessonId, date }),

  // Обновить рейтинг (триггер пересчёта)
  updateLeaderboard: (studentId: string, points: number, reason: string) =>
    sendWebhook('update-leaderboard', { studentId, points, reason }),

  // Создать ежемесячный отчёт
  createMonthlyReport: (month: string, year: number) =>
    sendWebhook('monthly-report', { month, year }),
}
