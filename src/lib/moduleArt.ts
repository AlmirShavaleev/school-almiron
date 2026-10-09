/**
 * §281. Карточка раздела курса у ученика: какой рисунок и какая пометка.
 *
 * Решение владельца 09.10: карточки разделов — в фирменном синем градиенте
 * (дизайн-система v2, «цвет несёт смысл»: радуга по порядку разделов смысла не
 * несла), у каждого раздела свой полупрозрачный рисунок в углу. Рисунок
 * выбирается по названию раздела — номеров разделов в базе нет, а названия
 * у физики устойчивые.
 */

export type ModuleArtKey =
  | 'math' | 'kinematics' | 'dynamics' | 'conservation' | 'statics' | 'oscillations'
  | 'molecular' | 'electric' | 'magnetic' | 'optics' | 'quantum' | 'ege' | 'orbit'

const RULES: [RegExp, ModuleArtKey][] = [
  [/мини-урок|формата\s+ЕГЭ|задачи\s+ЕГЭ|пробн/i, 'ege'],
  [/математ|алгебр|производн|интеграл/i, 'math'],
  [/кинемат/i, 'kinematics'],
  [/динамик/i, 'dynamics'],
  [/сохранени|импульс|энерги/i, 'conservation'],
  [/статик|гидростат/i, 'statics'],
  [/колебан|волн/i, 'oscillations'],
  [/молекул|термодин|газ/i, 'molecular'],
  [/электр|ток|заряд/i, 'electric'],
  [/магнит|индукц/i, 'magnetic'],
  [/оптик|свет|линз/i, 'optics'],
  [/квант|атом|ядр/i, 'quantum'],
]

export function moduleArtKey(title: string): ModuleArtKey {
  for (const [re, key] of RULES) if (re.test(title)) return key
  return 'orbit'
}

/**
 * Пометка вместо служебного номера: «100», «101» на карточке читались как
 * ошибка. Обычный раздел — «Раздел N»; практика и пилот (номера от 100) —
 * словами.
 */
export function moduleTag(title: string, orderIndex: number): string {
  if (/пилот/i.test(title)) return 'Пилот'
  if (orderIndex >= 100) return 'Практика ЕГЭ'
  return `Раздел ${orderIndex}`
}

/** Практика и пилот — тёмно-синие, как меню; разделы курса — синие, как действие. */
export function moduleIsPractice(title: string, orderIndex: number): boolean {
  return orderIndex >= 100 || /пилот/i.test(title)
}

/** «Механика: мини-уроки ЕГЭ (пилот)» → без «(пилот)»: пометка уже говорит это. */
export function moduleCardTitle(title: string): string {
  return title.replace(/\s*\(пилот\)\s*$/i, '').trim()
}
