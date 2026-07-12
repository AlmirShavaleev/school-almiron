import '@testing-library/jest-dom'

const mockCanvasContext = {
  canvas: undefined as HTMLCanvasElement | undefined,
  clearRect: () => {},
  save: () => {},
  restore: () => {},
  scale: () => {},
  rotate: () => {},
  translate: () => {},
  transform: () => {},
  setTransform: () => {},
  resetTransform: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  rect: () => {},
  fillRect: () => {},
  strokeRect: () => {},
  clip: () => {},
  arc: () => {},
  arcTo: () => {},
  ellipse: () => {},
  bezierCurveTo: () => {},
  quadraticCurveTo: () => {},
  drawImage: () => {},
  createImageData: () => ({ data: new Uint8ClampedArray(0) }),
  getImageData: () => ({ data: new Uint8ClampedArray(0) }),
  putImageData: () => {},
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createPattern: () => null,
  createRadialGradient: () => ({ addColorStop: () => {} }),
  fillText: () => {},
  strokeText: () => {},
  measureText: () => ({ width: 0 }),
  setLineDash: () => {},
  getLineDash: () => [],
}

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: function getContext() {
    return { ...mockCanvasContext, canvas: this } as unknown as CanvasRenderingContext2D
  },
})
