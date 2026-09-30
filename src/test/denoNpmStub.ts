// §247. Подмена `npm:`-импортов рендера PDF в edge-функции check-homework-ai для vitest
// (алиас в vitest.config.ts). Тесты обработчика работают с фотографиями, до рендера не доходят.
const unavailable = () => { throw new Error('рендер PDF в vitest не поддерживается') }
export const PDFiumLibrary = { init: unavailable }
export const encode = unavailable
export default { PDFiumLibrary, encode }
