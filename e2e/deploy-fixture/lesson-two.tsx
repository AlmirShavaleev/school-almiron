import { BUILD_ID } from '@/lib/buildVersion'
import './lesson-two.css'

export default function LessonTwo() {
  return <h2 className="fixture-lesson">Урок 2 · {BUILD_ID}</h2>
}
