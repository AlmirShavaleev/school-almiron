export interface VariantAssignmentSummary {
  students_created: number
  notifications_created: number
  telegram_connected: number
  telegram_not_connected: number
  telegram_queued: number
}

export function buildVariantAssignmentSummaryLines(summary: VariantAssignmentSummary) {
  return [
    `Назначено учеников: ${summary.students_created}`,
    `Внутренние уведомления: ${summary.notifications_created}`,
    `Telegram подключён: ${summary.telegram_connected}`,
    `Telegram не подключён: ${summary.telegram_not_connected}`,
    `В Telegram поставлено в очередь: ${summary.telegram_queued}`,
  ]
}
