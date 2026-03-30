import { prepareWithSegments, layoutNextLine } from 'https://esm.sh/@chenglou/pretext@0.0.3'

const stage = document.getElementById('ptx-stage')
const textLayer = document.getElementById('ptx-text-layer')
const orbLayer = document.getElementById('ptx-orb-layer')

if (stage && textLayer && orbLayer) {
  const STORY = [
    'The web still renders paragraphs like static print: measure, break lines, position each row, and pay the layout tax again and again.',
    'That flow works for documents, but interactive interfaces need text that reacts as quickly as touch, drag, and motion.',
    'Pretext precomputes language-aware segments once, then lays out each line as cheap arithmetic. No getBoundingClientRect. No offsetHeight. No sync reflow chain.',
    'In this scene, every glowing orb pushes the paragraph away. Move your cursor and the text reroutes in real time, as if words were fluid around gravity wells.',
    'The point is not decoration. It is control: virtualized feeds, stable scroll anchoring, editor overlays, and cinematic layouts that remain predictable at 60fps.'
  ].join(' ')

  const orbPalette = [
    'rgba(251, 191, 36, 0.44)',
    'rgba(34, 211, 238, 0.38)',
    'rgba(167, 139, 250, 0.35)',
    'rgba(251, 113, 133, 0.33)'
  ]

  const state = {
    prepared: null,
    font: '',
    fontSize: 0,
    lineHeight: 0,
    textWidth: 0,
    rafId: 0,
    linePool: [],
    orbs: [],
    pointer: {
      active: false,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0
    }
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  const makeOrb = (config) => {
    const el = document.createElement('div')
    el.className = 'ptx-orb'
    el.style.background = config.color
    el.style.width = `${config.r * 2}px`
    el.style.height = `${config.r * 2}px`
    orbLayer.appendChild(el)

    return {
      ...config,
      el,
      x: config.x,
      y: config.y,
      t: Math.random() * Math.PI * 2
    }
  }

  const syncTypography = () => {
    const stageWidth = stage.clientWidth
    state.fontSize = clamp(Math.round(stageWidth / 36), 22, 34)
    state.lineHeight = Math.round(state.fontSize * 1.33)
    state.textWidth = clamp(Math.round(stageWidth * 0.89), 760, 980)
    state.font = `500 ${state.fontSize}px "Cormorant Garamond", "Times New Roman", serif`
    state.prepared = prepareWithSegments(STORY, state.font)
    textLayer.style.font = state.font
    textLayer.style.lineHeight = `${state.lineHeight}px`
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

  const findBestGap = (yCenter, left, right) => {
    const intervals = []

    for (let i = 0; i < state.orbs.length; i += 1) {
      const orb = state.orbs[i]
      const dy = Math.abs(yCenter - orb.y)
      const blockR = orb.r + 8
      if (dy >= blockR) continue
      const dx = Math.sqrt(blockR * blockR - dy * dy)
      intervals.push([orb.x - dx, orb.x + dx])
    }

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
    if (gaps.length === 0) return null

    let best = gaps[0]
    for (let i = 1; i < gaps.length; i += 1) {
      if (gaps[i][1] - gaps[i][0] > best[1] - best[0]) best = gaps[i]
    }

    return best
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
    const minWidth = Math.max(state.fontSize * 4, 140)

    let y = top
    let lineCount = 0
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    const lines = []

    while (y < bottom && lineCount < 280) {
      const yCenter = y + state.lineHeight * 0.5
      const bestGap = findBestGap(yCenter, left, right)

      if (!bestGap || bestGap[1] - bestGap[0] < minWidth) {
        y += state.lineHeight
        lineCount += 1
        continue
      }

      const maxWidth = Math.floor(bestGap[1] - bestGap[0] - 6)
      const line = layoutNextLine(state.prepared, cursor, maxWidth)
      if (!line) break

      const x = Math.round(bestGap[0] + 2)
      lines.push({ x, y, text: line.text })
      cursor = line.end
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

  const updateOrbs = (time) => {
    const w = stage.clientWidth
    const h = stage.clientHeight

    state.pointer.x += (state.pointer.targetX - state.pointer.x) * 0.16
    state.pointer.y += (state.pointer.targetY - state.pointer.y) * 0.16

    for (let i = 0; i < state.orbs.length; i += 1) {
      const orb = state.orbs[i]

      if (orb.type === 'cursor') {
        const fallbackX = w * 0.75
        const fallbackY = h * 0.52
        orb.x = state.pointer.active ? state.pointer.x : fallbackX
        orb.y = state.pointer.active ? state.pointer.y : fallbackY
        const pulse = 1 + Math.sin(time * 0.004) * 0.06
        orb.el.style.transform = `translate3d(${orb.x - orb.r}px, ${orb.y - orb.r}px, 0) scale(${pulse})`
        orb.el.style.opacity = state.pointer.active ? '1' : '0.72'
        continue
      }

      orb.t += 0.012
      orb.x += orb.vx
      orb.y += orb.vy
      orb.y += Math.sin(orb.t + i) * 0.24

      if (orb.x < orb.r + 26 || orb.x > w - orb.r - 26) orb.vx *= -1
      if (orb.y < orb.r + 20 || orb.y > h - orb.r - 20) orb.vy *= -1

      orb.el.style.transform = `translate3d(${orb.x - orb.r}px, ${orb.y - orb.r}px, 0)`
    }
  }

  const frame = (time) => {
    updateOrbs(time)
    renderTextFlow()
    state.rafId = requestAnimationFrame(frame)
  }

  const buildScene = () => {
    orbLayer.innerHTML = ''
    state.orbs = [
      makeOrb({ x: stage.clientWidth * 0.74, y: stage.clientHeight * 0.24, r: 116, vx: 0.44, vy: 0.28, color: orbPalette[0], type: 'float' }),
      makeOrb({ x: stage.clientWidth * 0.86, y: stage.clientHeight * 0.37, r: 88, vx: -0.38, vy: 0.31, color: orbPalette[1], type: 'float' }),
      makeOrb({ x: stage.clientWidth * 0.8, y: stage.clientHeight * 0.54, r: 94, vx: 0.35, vy: -0.24, color: orbPalette[2], type: 'float' }),
      makeOrb({ x: stage.clientWidth * 0.68, y: stage.clientHeight * 0.72, r: 68, vx: 0.3, vy: 0.34, color: orbPalette[3], type: 'float' }),
      makeOrb({ x: stage.clientWidth * 0.76, y: stage.clientHeight * 0.5, r: 104, vx: 0, vy: 0, color: 'rgba(147, 197, 253, 0.24)', type: 'cursor' })
    ]
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
    buildScene()
  })

  syncTypography()
  buildScene()
  state.pointer.targetX = stage.clientWidth * 0.74
  state.pointer.targetY = stage.clientHeight * 0.5
  state.pointer.x = state.pointer.targetX
  state.pointer.y = state.pointer.targetY
  state.rafId = requestAnimationFrame(frame)
}
