import { Link } from 'react-router-dom'
import { GraduationCap, CheckCircle, Trophy, Users, Star, ArrowRight, CreditCard } from 'lucide-react'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="border-b border-gray-100 sticky top-0 bg-white/95 backdrop-blur z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <GraduationCap size={18} className="text-white" />
            </div>
            <span className="font-bold text-gray-900">Школа Almiron</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900 text-sm font-medium flex items-center gap-1.5">
              <CreditCard size={15} />Тарифы
            </Link>
            <Link to="/login" className="text-gray-600 hover:text-gray-900 text-sm font-medium">Войти</Link>
            <Link to="/register" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
              Начать учиться
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
          🎯 Подготовка к ЕГЭ и ОГЭ
        </div>
        <h1 className="text-5xl font-bold text-gray-900 mb-6 leading-tight">
          Сдай ЕГЭ по физике и<br />математике на <span className="text-primary-600">90+</span> баллов
        </h1>
        <p className="text-xl text-gray-500 mb-8 max-w-2xl mx-auto">
          Онлайн-школа с персональным подходом, умной системой геймификации и полным сопровождением до дня экзамена
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/register" className="flex items-center gap-2 bg-primary-600 text-white px-8 py-4 rounded-xl text-base font-semibold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200">
            Попробовать бесплатно <ArrowRight size={18} />
          </Link>
          <Link to="/login" className="px-8 py-4 rounded-xl text-base font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors">
            Войти в кабинет
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-gray-100 py-12 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-4 gap-6">
          {[
            { value: '200+', label: 'выпускников' },
            { value: '87', label: 'средний балл ЕГЭ' },
            { value: '95%', label: 'поступили в вузы мечты' },
            { value: '4.9★', label: 'рейтинг школы' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold text-primary-600">{s.value}</div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">Почему Almiron?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: '🎯', title: 'Персональный план', text: 'Индивидуальный план подготовки с учётом текущего уровня и цели' },
            { icon: '🏆', title: 'Геймификация', text: 'XP-баллы, лиги, достижения — учёба превращается в игру' },
            { icon: '👨‍💻', title: 'Онлайн-кабинеты', text: 'Отдельные кабинеты для ученика, родителя, учителя и куратора' },
            { icon: '📊', title: 'Аналитика прогресса', text: 'Следите за динамикой баллов на пробных экзаменах' },
            { icon: '⚡', title: 'Мгновенная обратная связь', text: 'Проверка ДЗ и комментарии преподавателя в течение 24 часов' },
            { icon: '🤝', title: 'Куратор-сопровождение', text: 'Персональный куратор следит за прогрессом и мотивацией' },
          ].map(f => (
            <div key={f.title} className="p-6 rounded-2xl border border-gray-100 hover:border-primary-200 hover:shadow-md transition-all">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-semibold text-gray-900 text-lg mb-2">{f.title}</h3>
              <p className="text-gray-500">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary-600 py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Записаться на пробное занятие</h2>
          <p className="text-primary-100 mb-8">Первое занятие бесплатно. Оцените качество и формат работы.</p>
          <Link to="/register" className="inline-flex items-center gap-2 bg-white text-primary-600 px-8 py-4 rounded-xl font-semibold hover:bg-primary-50 transition-colors">
            Записаться сейчас <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-sm text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary-600 rounded flex items-center justify-center">
              <GraduationCap size={14} className="text-white" />
            </div>
            <span>Школа Almiron © 2024</span>
          </div>
          <span>ЕГЭ • ОГЭ • Физика • Математика</span>
        </div>
      </footer>
    </div>
  )
}
