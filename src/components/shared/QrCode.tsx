import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * Маленький QR — половина учеников открывает платформу с компьютера, а
 * Telegram у них в телефоне; голая ссылка в таком случае ведёт в никуда.
 * `qrcode-generator` — самая лёгкая из проверенных библиотек (без зависимостей,
 * синхронная), в проекте до этого QR не было вообще.
 */
export function QrCode({ value, size = 148 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    return qr.createSvgTag({ scalable: true })
  }, [value])

  return (
    <div
      style={{ width: size, height: size }}
      className="shrink-0 rounded-xl border border-gray-200 bg-white p-2"
      // Свой же сгенерированный SVG из доверенного значения (ссылка на бота) — не пользовательский ввод.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
