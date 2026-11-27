declare const __ALMIRON_BUILD_ID__: string
export const BUILD_ID = typeof __ALMIRON_BUILD_ID__ === 'string' ? __ALMIRON_BUILD_ID__ : 'dev'
