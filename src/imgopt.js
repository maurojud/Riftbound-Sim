// Kartenbilder verkleinern: lange Seite höchstens 900 px, WebP. Das spart pro Karte meist 90 % der Daten.
export const MAX_SIDE = 900
export async function shrinkImage(blob, maxSide = MAX_SIDE) {
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale))
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const toBlob = (type, q) => new Promise((res) => cv.toBlob(res, type, q))
  let out = await toBlob('image/webp', 0.82)
  if (!out || out.type !== 'image/webp') out = await toBlob('image/jpeg', 0.85) // z. B. Safari kann kein WebP
  return { blob: out, width: w, height: h, original: { width: bmp.width, height: bmp.height } }
}
// Verkleinern lohnt sich nur, wenn das Bild größer als nötig oder deutlich schwerer als erwartet ist
export const worthShrinking = (blob, dims) => Math.max(dims.width, dims.height) > MAX_SIDE * 1.05 || blob.size > 180 * 1024
