/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#b8d8ff',
          300: '#86bbfb',
          400: '#4d97f0',
          500: '#2575dc',
          600: '#185bb9',
          700: '#174a94',
          800: '#183f78',
          900: '#19365f',
          950: '#0b1830',
        },
        gold: {
          50: '#fff8eb',
          100: '#fdecc6',
          200: '#f8d889',
          300: '#efbd4c',
          400: '#dfa129',
          500: '#c8841a',
          600: '#a46116',
          700: '#83481a',
          800: '#6f3d1d',
          900: '#60351e',
        },
        graphite: {
          50: '#f7f8fb',
          100: '#eef1f6',
          200: '#dce2eb',
          300: '#c1ccd9',
          400: '#91a2b8',
          500: '#647894',
          600: '#4b5d75',
          700: '#3e4c60',
          800: '#263244',
          900: '#172033',
          950: '#0b1020',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
