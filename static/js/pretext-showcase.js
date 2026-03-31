import { prepareWithSegments, layoutNextLine } from 'https://esm.sh/@chenglou/pretext@0.0.3'

const stage = document.getElementById('ptx-stage')
const textLayer = document.getElementById('ptx-text-layer')
const gif = document.getElementById('ptx-gif')

if (stage && textLayer && gif) {
  const STORY = [
    'The web still renders paragraphs like static print: measure, break lines, position each row, and pay the layout tax again and again.',
    'That flow works for documents, but interactive interfaces need text that reacts as quickly as touch, drag, and motion.',
    'Pretext precomputes language-aware segments once, then lays out each line as cheap arithmetic. No getBoundingClientRect. No offsetHeight. No sync reflow chain.',
    'In this scene, every glowing orb pushes the paragraph away. Move your cursor and the text reroutes in real time, as if words were fluid around gravity wells.',
    'The point is not decoration. It is control: virtualized feeds, stable scroll anchoring, editor overlays, and cinematic layouts that remain predictable at 60fps.'
  ].join(' ')

  const state = {
    prepared: null,
    font: '',
    fontSize: 0,
    lineHeight: 0,
    textWidth: 0,
    rafId: 0,
    linePool: [],
    gifMaskReadable: true,
    gifCanvas: document.createElement('canvas'),
    gifCtx: null,
    gifBox: {
      x: 0,
      y: 0,
      w: 0,
      h: 0
    },
    pointer: {
      active: false,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0
    }
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  state.gifCtx = state.gifCanvas.getContext('2d', { willReadFrequently: true })

  const syncTypography = () => {
    const stageWidth = stage.clientWidth
    state.fontSize = clamp(Math.round(stageWidth / 36), 22, 34)
    state.lineHeight = Math.round(state.fontSize * 1.33)
    state.textWidth = clamp(Math.round(stageWidth * 0.89), 760, 980)
    state.font = `500 ${state.fontSize}px "Cormorant Garamond", "Times New Roman", serif`
    state.prepared = prepareWithSegments(STORY, state.font)
    textLayer.style.font = state.font
    textLayer.style.lineHeight = `${state.lineHeight}px`
    const gifW = clamp(Math.round(stageWidth * 0.2), 170, 290)
    gif.style.width = `${gifW}px`
  }

  const mergeIntervals = (intervals) => {
    if (intervals.length === 0) return []
    intervals.sort((a, b) => a[0] - b[0])
    const merged = [intervals[0]]

    for (let i = 1; i < intervals.length; i += 1) {
      const current = intervals[i]
      const prev = merged[merged.length - 1]
      if (current[0] <= prev[1]) {
        prev[1] = Math.max(prev[1], current[1])
      } else {
        merged.push(current)
      }
    }

    return merged
  }

  const getMaskedIntervals = (yCenter, left, right) => {
    const intervals = []
    const y = Math.round(yCenter)
    const { x, y: gifY, w, h } = state.gifBox

    if (y < gifY || y >= gifY + h || w <= 0 || h <= 0) return intervals

    const localY = y - gifY
    const startX = Math.max(Math.floor(left), x)
    const endX = Math.min(Math.ceil(right), x + w)

    if (endX <= startX) return intervals

    if (!state.gifMaskReadable || !state.gifCtx) {
      intervals.push([x, x + w])
      return intervals
    }

    try {
      const scan = state.gifCtx.getImageData(startX - x, localY, endX - startX, 1).data
      const alphaThreshold = 22
      const padding = 14
      let runStart = -1

      for (let i = 0; i < scan.length; i += 4) {
        const alpha = scan[i + 3]
        const px = startX + i / 4
        if (alpha > alphaThreshold) {
          if (runStart < 0) runStart = px
        } else if (runStart >= 0) {
          intervals.push([runStart - padding, px + padding])
          runStart = -1
        }
      }

      if (runStart >= 0) intervals.push([runStart - padding, endX + padding])
    } catch {
      state.gifMaskReadable = false
      intervals.push([x, x + w])
    }

    return intervals
  }

  const getAvailableGaps = (yCenter, left, right) => {
    const intervals = getMaskedIntervals(yCenter, left, right)

    const merged = mergeIntervals(intervals)
    const gaps = []
    let cursor = left

    for (let i = 0; i < merged.length; i += 1) {
      const start = clamp(merged[i][0], left, right)
      const end = clamp(merged[i][1], left, right)
      if (start > cursor) gaps.push([cursor, start])
      cursor = Math.max(cursor, end)
    }

    if (cursor < right) gaps.push([cursor, right])
    return gaps
  }

  const ensureLinePool = (count) => {
    while (state.linePool.length < count) {
      const el = document.createElement('div')
      el.className = 'ptx-line'
      textLayer.appendChild(el)
      state.linePool.push(el)
    }
  }

  const renderTextFlow = () => {
    if (!state.prepared) return

    const stageWidth = stage.clientWidth
    const stageHeight = stage.clientHeight
    const left = (stageWidth - state.textWidth) / 2
    const right = left + state.textWidth
    const top = 20
    const bottom = stageHeight - 24
    const minGapWidth = Math.max(state.fontSize * 1.25, 34)

    let y = top
    let lineCount = 0
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    const lines = []

    while (y < bottom && lineCount < 280) {
      const yCenter = y + state.lineHeight * 0.5
      const gaps = getAvailableGaps(yCenter, left, right)

      if (gaps.length === 0) {
        y += state.lineHeight
        lineCount += 1
        continue
      }

      let placedOnRow = false

      for (let i = 0; i < gaps.length; i += 1) {
        const gap = gaps[i]
        const gapWidth = gap[1] - gap[0]
        if (gapWidth < minGapWidth) continue

        const maxWidth = Math.floor(gapWidth - 6)
        const line = layoutNextLine(state.prepared, cursor, maxWidth)
        if (!line) {
          y = bottom
          break
        }

        const x = Math.round(gap[0] + 2)
        lines.push({ x, y, text: line.text })
        cursor = line.end
        placedOnRow = true
      }

      if (!placedOnRow) {
        y += state.lineHeight
        lineCount += 1
        continue
      }

      y += state.lineHeight
      lineCount += 1
    }

    ensureLinePool(lines.length)

    for (let i = 0; i < state.linePool.length; i += 1) {
      const el = state.linePool[i]
      const line = lines[i]
      if (!line) {
        el.style.opacity = '0'
        continue
      }

      if (el.textContent !== line.text) el.textContent = line.text
      el.style.opacity = '1'
      el.style.transform = `translate3d(${line.x}px, ${line.y}px, 0)`
    }
  }

  const updateGifMask = () => {
    const w = Math.max(Math.round(state.gifBox.w), 1)
    const h = Math.max(Math.round(state.gifBox.h), 1)

    if (!state.gifCtx) return
    if (state.gifCanvas.width !== w) state.gifCanvas.width = w
    if (state.gifCanvas.height !== h) state.gifCanvas.height = h

    state.gifCtx.clearRect(0, 0, w, h)
    try {
      state.gifCtx.drawImage(gif, 0, 0, w, h)
    } catch {
      state.gifMaskReadable = false
    }
  }

  const updateGif = (time) => {
    const w = stage.clientWidth
    const h = stage.clientHeight

    state.pointer.x += (state.pointer.targetX - state.pointer.x) * 0.16
    state.pointer.y += (state.pointer.targetY - state.pointer.y) * 0.16

    const gifRect = gif.getBoundingClientRect()
    const gifW = Math.max(gifRect.width, 1)
    const gifH = Math.max(gifRect.height, 1)
    const floatX = Math.sin(time * 0.0016) * 6
    const floatY = Math.cos(time * 0.0013) * 4

    const fallbackX = w * 0.74
    const fallbackY = h * 0.52
    const targetX = state.pointer.active ? state.pointer.x : fallbackX
    const targetY = state.pointer.active ? state.pointer.y : fallbackY

    const centerX = clamp(targetX + floatX, gifW * 0.45, w - gifW * 0.45)
    const centerY = clamp(targetY + floatY, gifH * 0.45, h - gifH * 0.45)

    state.gifBox.x = Math.round(centerX - gifW * 0.5)
    state.gifBox.y = Math.round(centerY - gifH * 0.5)
    state.gifBox.w = Math.round(gifW)
    state.gifBox.h = Math.round(gifH)

    gif.style.transform = `translate3d(${state.gifBox.x}px, ${state.gifBox.y}px, 0)`
    gif.style.opacity = state.pointer.active ? '1' : '0.88'
    gif.style.filter = `drop-shadow(0 14px 24px rgba(7, 10, 25, 0.48)) hue-rotate(${Math.sin(time * 0.0007) * 3}deg)`

    updateGifMask()
  }

  const frame = (time) => {
    updateGif(time)
    renderTextFlow()
    state.rafId = requestAnimationFrame(frame)
  }

  const onPointerMove = (event) => {
    const rect = stage.getBoundingClientRect()
    state.pointer.targetX = event.clientX - rect.left
    state.pointer.targetY = event.clientY - rect.top
    if (!state.pointer.active) state.pointer.active = true
  }

  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerenter', onPointerMove)
  stage.addEventListener('pointerleave', () => {
    state.pointer.active = false
  })

  window.addEventListener('resize', () => {
    syncTypography()
  })

  syncTypography()
  state.gifMaskReadable = true
  updateGifMask()
  state.pointer.targetX = stage.clientWidth * 0.74
  state.pointer.targetY = stage.clientHeight * 0.5
  state.pointer.x = state.pointer.targetX
  state.pointer.y = state.pointer.targetY

  if (gif.complete) {
    updateGifMask()
    state.rafId = requestAnimationFrame(frame)
  } else {
    gif.addEventListener('load', () => {
      state.gifMaskReadable = true
      updateGifMask()
      if (!state.rafId) state.rafId = requestAnimationFrame(frame)
    }, { once: true })
    gif.addEventListener('error', () => {
      if (!state.rafId) state.rafId = requestAnimationFrame(frame)
    }, { once: true })
  }
}
