<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Bot, Gamepad2, Play, RefreshCw, User } from '@lucide/vue'

// 等待/下载期间的小游戏区：俄罗斯方块 / 乒乓球 / 贪吃蛇。
// 每次挂载随机先展示一种；玩家可自己玩或看 AI 玩（乒乓球另有 AI 对战）；
// 累计游玩 5 分钟后解锁另外两种游戏的切换按钮。全部 Canvas 实现，零依赖。

const GAMES = ['tetris', 'pong', 'snake']
const GAME_LABELS = { tetris: '俄罗斯方块', pong: '乒乓球', snake: '贪吃蛇' }

const selected = ref(GAMES[Math.floor(Math.random() * GAMES.length)])
const mode = ref('player') // 当前游戏的模式：player=自己玩 ai=看AI；乒乓球额外有 'aivai'
const playSeconds = ref(0)
const unlocked = computed(() => playSeconds.value >= 300)
const score = ref(0)
const gameOver = ref(false)

let secondsTimer = null
let raf = 0
let tickTimer = null
let keyHandler = null
let cleanupGame = null // 每种游戏各自的停止函数

const canvasRef = ref(null)

const INSTRUCTIONS = {
  tetris: {
    player: '← → 移动 · ↑ 旋转 · ↓ 加速下落。消除整行得分，堆到顶部即结束。',
    ai: 'AI 会为每个方块挑选消除行数最多、空洞最少的位置自动摆放，您只需观看。'
  },
  pong: {
    player: '移动鼠标或按 ↑ ↓ 控制左侧球拍，先得 5 分的一方获胜。',
    ai: '两侧球拍均由 AI 控制（左侧 AI 略慢，右侧 AI 略快），比拼谁先到 5 分。',
    aivai: '两侧球拍均由 AI 控制（左侧 AI 略慢，右侧 AI 略快），比拼谁先到 5 分。'
  },
  snake: {
    player: '方向键控制蛇的移动方向，吃到红色食物加 1 分，撞墙或咬到自己即结束。',
    ai: 'AI 每步选择靠近食物且不撞的安全方向自动觅食，您只需观看。'
  }
}

const instructionText = computed(() => {
  const game = INSTRUCTIONS[selected.value]
  return game[mode.value] || game.player
})

const modeButtons = computed(() => {
  if (selected.value === 'pong') {
    return [
      { id: 'aivai', label: 'AI 对战' },
      { id: 'player', label: '我对 AI' }
    ]
  }
  return [
    { id: 'player', label: '自己玩' },
    { id: 'ai', label: '看 AI 玩' }
  ]
})

const switchChoices = computed(() => GAMES.filter((game) => game !== selected.value))

function setMode(next) {
  mode.value = next
  restart()
}

function switchGame(game) {
  selected.value = game
  mode.value = game === 'pong' ? 'aivai' : 'player'
  playSeconds.value = 0 // 换游戏重新计时解锁
  restart()
}

// ── 通用画布工具 ──
function setupCanvas(width, height) {
  const canvas = canvasRef.value
  if (!canvas) return null
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.fillStyle = '#151613'
  context.fillRect(0, 0, width, height)
  return context
}

function stopLoops() {
  if (raf) cancelAnimationFrame(raf)
  if (tickTimer) clearInterval(tickTimer)
  raf = 0
  tickTimer = null
  if (keyHandler) {
    window.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
  if (cleanupGame) {
    cleanupGame()
    cleanupGame = null
  }
}

function restart() {
  score.value = 0
  gameOver.value = false
  stopLoops()
  ;({ tetris: startTetris, pong: startPong, snake: startSnake }[selected.value] || startSnake)()
}

// ── 俄罗斯方块 ──
const TETRIS_COLS = 10
const TETRIS_ROWS = 18
const TETRIS_CELL = 20
const TETRIS_SHAPES = [
  { cells: [[1, 1, 1, 1]], color: '#62d6a3' },
  { cells: [[1, 1], [1, 1]], color: '#e3b253' },
  { cells: [[0, 1, 0], [1, 1, 1]], color: '#6aa9e0' },
  { cells: [[1, 0, 0], [1, 1, 1]], color: '#e08a6a' },
  { cells: [[0, 0, 1], [1, 1, 1]], color: '#b28ae0' },
  { cells: [[1, 1, 0], [0, 1, 1]], color: '#e0d26a' },
  { cells: [[0, 1, 1], [1, 1, 0]], color: '#6ae0c0' }
]

function rotateCells(cells) {
  const rows = cells.length
  const cols = cells[0].length
  const rotated = Array.from({ length: cols }, () => Array(rows).fill(0))
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) rotated[c][rows - 1 - r] = cells[r][c]
  }
  return rotated
}

function startTetris() {
  const context = setupCanvas(TETRIS_COLS * TETRIS_CELL, TETRIS_ROWS * TETRIS_CELL)
  if (!context) return
  const grid = Array.from({ length: TETRIS_ROWS }, () => Array(TETRIS_COLS).fill(null))
  let piece = null
  let aiPlan = null
  let over = false

  const spawn = () => {
    const shape = TETRIS_SHAPES[Math.floor(Math.random() * TETRIS_SHAPES.length)]
    piece = { cells: shape.cells.map((row) => [...row]), color: shape.color, row: 0, col: 3 }
    aiPlan = null
    if (collides(piece.cells, piece.row, piece.col)) over = true
  }

  const collides = (cells, row, col) => {
    for (let r = 0; r < cells.length; r += 1) {
      for (let c = 0; c < cells[r].length; c += 1) {
        if (!cells[r][c]) continue
        const y = row + r
        const x = col + c
        if (x < 0 || x >= TETRIS_COLS || y >= TETRIS_ROWS) return true
        if (y >= 0 && grid[y][x]) return true
      }
    }
    return false
  }

  const merge = () => {
    piece.cells.forEach((row, r) => row.forEach((value, c) => {
      if (value && piece.row + r >= 0) grid[piece.row + r][piece.col + c] = piece.color
    }))
    for (let r = TETRIS_ROWS - 1; r >= 0; r -= 1) {
      if (grid[r].every(Boolean)) {
        grid.splice(r, 1)
        grid.unshift(Array(TETRIS_COLS).fill(null))
        score.value += 1
        r += 1
      }
    }
  }

  const landingRow = (cells, col) => {
    let row = -2
    while (!collides(cells, row + 1, col)) row += 1
    return row
  }

  // 经典启发式：消行加分，空洞与高度差扣分
  const evaluate = (cells, col) => {
    const row = landingRow(cells, col)
    const preview = grid.map((line) => [...line])
    for (let r = 0; r < cells.length; r += 1) {
      for (let c = 0; c < cells[r].length; c += 1) {
        if (cells[r][c] && row + r >= 0) preview[row + r][col + c] = '#fff'
      }
    }
    let holes = 0
    let aggregate = 0
    const heights = []
    for (let x = 0; x < TETRIS_COLS; x += 1) {
      let height = 0
      let seen = false
      for (let y = 0; y < TETRIS_ROWS; y += 1) {
        if (preview[y][x]) { height = TETRIS_ROWS - y; seen = true }
        else if (seen) holes += 1
      }
      heights.push(height)
      aggregate += height
    }
    let lines = 0
    for (let y = 0; y < TETRIS_ROWS; y += 1) if (preview[y].every(Boolean)) lines += 1
    let bumpiness = 0
    for (let x = 0; x < heights.length - 1; x += 1) bumpiness += Math.abs(heights[x] - heights[x + 1])
    return lines * 76 - holes * 51 - aggregate * 5 - bumpiness * 18
  }

  const planAiMove = () => {
    let best = null
    let cells = piece.cells.map((row) => [...row])
    for (let rotation = 0; rotation < 4; rotation += 1) {
      for (let col = -2; col < TETRIS_COLS; col += 1) {
        if (collides(cells, piece.row, col)) continue
        const value = evaluate(cells, col)
        if (!best || value > best.value) best = { cells: cells.map((row) => [...row]), col, rotation, value }
      }
      cells = rotateCells(cells)
    }
    aiPlan = best
  }

  const draw = () => {
    context.fillStyle = '#151613'
    context.fillRect(0, 0, TETRIS_COLS * TETRIS_CELL, TETRIS_ROWS * TETRIS_CELL)
    const drawCell = (x, y, color) => {
      context.fillStyle = color
      context.fillRect(x * TETRIS_CELL + 1, y * TETRIS_CELL + 1, TETRIS_CELL - 2, TETRIS_CELL - 2)
    }
    grid.forEach((row, y) => row.forEach((value, x) => { if (value) drawCell(x, y, value) }))
    if (piece && !over) piece.cells.forEach((row, r) => row.forEach((value, c) => {
      if (value && piece.row + r >= 0) drawCell(piece.col + c, piece.row + r, piece.color)
    }))
    if (over) {
      context.fillStyle = 'rgba(21,22,19,0.75)'
      context.fillRect(0, TETRIS_ROWS * TETRIS_CELL / 2 - 24, TETRIS_COLS * TETRIS_CELL, 48)
      context.fillStyle = '#62d6a3'
      context.font = '16px "Microsoft YaHei UI"'
      context.textAlign = 'center'
      context.fillText('本局结束 · 得分 ' + score.value, TETRIS_COLS * TETRIS_CELL / 2, TETRIS_ROWS * TETRIS_CELL / 2 + 6)
    }
  }

  const tick = () => {
    if (over) { draw(); return }
    if (mode.value === 'ai') {
      if (!aiPlan) planAiMove()
      if (aiPlan) {
        if (piece.col > aiPlan.col) piece.col -= 1
        else if (piece.col < aiPlan.col) piece.col += 1
        else if (JSON.stringify(piece.cells) !== JSON.stringify(aiPlan.cells)) piece.cells = aiPlan.cells
      }
    }
    if (!collides(piece.cells, piece.row + 1, piece.col)) {
      piece.row += 1
    } else {
      merge()
      if (!over) spawn()
    }
    draw()
  }

  keyHandler = (event) => {
    if (mode.value !== 'player' || over) return
    const moves = {
      ArrowLeft: () => { if (!collides(piece.cells, piece.row, piece.col - 1)) piece.col -= 1 },
      ArrowRight: () => { if (!collides(piece.cells, piece.row, piece.col + 1)) piece.col += 1 },
      ArrowUp: () => {
        const rotated = rotateCells(piece.cells)
        if (!collides(rotated, piece.row, piece.col)) piece.cells = rotated
      },
      ArrowDown: () => { if (!collides(piece.cells, piece.row + 1, piece.col)) piece.row += 1 }
    }
    if (moves[event.key]) {
      event.preventDefault()
      moves[event.key]()
      draw()
    }
  }
  window.addEventListener('keydown', keyHandler, { passive: false })
  spawn()
  draw()
  tickTimer = setInterval(tick, mode.value === 'ai' ? 90 : 550)
  cleanupGame = () => {}
}

// ── 乒乓球 ──
function startPong() {
  const width = 320
  const height = 200
  const context = setupCanvas(width, height)
  if (!context) return
  const state = {
    left: { y: height / 2 - 22 },
    right: { y: height / 2 - 22 },
    ball: { x: width / 2, y: height / 2, vx: 2.6, vy: 1.6 },
    leftScore: 0,
    rightScore: 0
  }
  const paddleHeight = 44
  const paddleWidth = 7
  const playerIsLeft = mode.value === 'player'
  let mouseYY = null

  const bounce = (paddleY, ballY) => ((ballY - (paddleY + paddleHeight / 2)) / (paddleHeight / 2)) * 3.2

  const step = () => {
    state.ball.x += state.ball.vx
    state.ball.y += state.ball.vy
    if (state.ball.y < 4 || state.ball.y > height - 4) state.ball.vy *= -1
    const aiSpeed = 2.4
    const rightTarget = state.ball.y - paddleHeight / 2
    if (state.right.y + paddleHeight / 2 < rightTarget) state.right.y = Math.min(state.right.y + aiSpeed * 1.1, rightTarget)
    else state.right.y = Math.max(state.right.y - aiSpeed * 1.1, rightTarget)
    if (playerIsLeft) {
      if (mouseYY != null) state.left.y = Math.max(0, Math.min(height - paddleHeight, mouseYY - paddleHeight / 2))
    } else {
      const leftTarget = state.ball.y - paddleHeight / 2
      if (state.left.y + paddleHeight / 2 < leftTarget) state.left.y = Math.min(state.left.y + aiSpeed, leftTarget)
      else state.left.y = Math.max(state.left.y - aiSpeed, leftTarget)
    }
    if (state.ball.x < paddleWidth + 4 && state.ball.x > paddleWidth
      && state.ball.y > state.left.y && state.ball.y < state.left.y + paddleHeight && state.ball.vx < 0) {
      state.ball.vx = Math.abs(state.ball.vx)
      state.ball.vy += bounce(state.left.y, state.ball.y)
    }
    if (state.ball.x > width - paddleWidth - 4 && state.ball.x < width - paddleWidth
      && state.ball.y > state.right.y && state.ball.y < state.right.y + paddleHeight && state.ball.vx > 0) {
      state.ball.vx = -Math.abs(state.ball.vx)
      state.ball.vy += bounce(state.right.y, state.ball.y)
    }
    if (state.ball.x < -6) { state.rightScore += 1; resetBall() }
    if (state.ball.x > width + 6) { state.leftScore += 1; resetBall() }
    if (state.leftScore >= 5 || state.rightScore >= 5) gameOver.value = true
  }

  const resetBall = () => {
    state.ball = { x: width / 2, y: height / 2, vx: (Math.random() > 0.5 ? 2.6 : -2.6), vy: (Math.random() - 0.5) * 3 }
  }

  const draw = () => {
    context.fillStyle = '#151613'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = 'rgba(255,255,255,0.15)'
    context.setLineDash([6, 8])
    context.beginPath()
    context.moveTo(width / 2, 0)
    context.lineTo(width / 2, height)
    context.stroke()
    context.setLineDash([])
    context.fillStyle = '#62d6a3'
    context.fillRect(4, state.left.y, paddleWidth, paddleHeight)
    context.fillStyle = '#e08a6a'
    context.fillRect(width - 4 - paddleWidth, state.right.y, paddleWidth, paddleHeight)
    context.fillStyle = '#e8eadf'
    context.fillRect(state.ball.x - 3, state.ball.y - 3, 6, 6)
    context.font = '20px Bahnschrift, sans-serif'
    context.textAlign = 'center'
    context.fillStyle = 'rgba(255,255,255,0.4)'
    context.fillText(String(state.leftScore), width / 2 - 36, 30)
    context.fillText(String(state.rightScore), width / 2 + 36, 30)
    if (gameOver.value) {
      context.fillStyle = '#62d6a3'
      context.font = '15px "Microsoft YaHei UI"'
      context.fillText('本局结束', width / 2, height / 2 + 40)
    }
  }

  const onMouse = (event) => {
    const rect = canvasRef.value.getBoundingClientRect()
    mouseYY = ((event.clientY - rect.top) / rect.height) * height
  }
  if (playerIsLeft) canvasRef.value.addEventListener('mousemove', onMouse)

  keyHandler = (event) => {
    if (!playerIsLeft) return
    const speed = 18
    if (event.key === 'ArrowUp') { event.preventDefault(); mouseYY = (mouseYY ?? height / 2) - speed }
    if (event.key === 'ArrowDown') { event.preventDefault(); mouseYY = (mouseYY ?? height / 2) + speed }
    if (mouseYY != null) state.left.y = Math.max(0, Math.min(height - paddleHeight, mouseYY - paddleHeight / 2))
  }
  window.addEventListener('keydown', keyHandler, { passive: false })

  const loop = () => {
    if (!gameOver.value) step()
    draw()
    raf = requestAnimationFrame(loop)
  }
  cleanupGame = () => { if (playerIsLeft) canvasRef.value?.removeEventListener('mousemove', onMouse) }
  draw()
  raf = requestAnimationFrame(loop)
}

// ── 贪吃蛇 ──
function startSnake() {
  const cells = 20
  const cellSize = 15
  const context = setupCanvas(cells * cellSize, cells * cellSize)
  if (!context) return
  let snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]
  let direction = { x: 1, y: 0 }
  let pendingDirection = direction
  let food = { x: 14, y: 10 }

  const respawnFood = () => {
    for (;;) {
      const candidate = { x: Math.floor(Math.random() * cells), y: Math.floor(Math.random() * cells) }
      if (!snake.some((part) => part.x === candidate.x && part.y === candidate.y)) { food = candidate; return }
    }
  }

  const step = () => {
    if (mode.value === 'ai') {
      const head = snake[0]
      const options = [
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }
      ].filter((option) => !(option.x === -direction.x && option.y === -direction.y))
      const safe = options.filter((option) => {
        const next = { x: head.x + option.x, y: head.y + option.y }
        return next.x >= 0 && next.x < cells && next.y >= 0 && next.y < cells
          && !snake.some((part) => part.x === next.x && part.y === next.y)
      })
      if (safe.length) {
        safe.sort((a, b) => {
          const distance = (option) => Math.abs(head.x + option.x - food.x) + Math.abs(head.y + option.y - food.y)
          return distance(a) - distance(b)
        })
        pendingDirection = safe[0]
      }
    }
    direction = pendingDirection
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y }
    if (head.x < 0 || head.x >= cells || head.y < 0 || head.y >= cells
      || snake.some((part) => part.x === head.x && part.y === head.y)) {
      gameOver.value = true
      return
    }
    snake.unshift(head)
    if (head.x === food.x && head.y === food.y) {
      score.value += 1
      respawnFood()
    } else {
      snake.pop()
    }
  }

  const draw = () => {
    context.fillStyle = '#151613'
    context.fillRect(0, 0, cells * cellSize, cells * cellSize)
    context.fillStyle = '#e06a6a'
    context.fillRect(food.x * cellSize + 2, food.y * cellSize + 2, cellSize - 4, cellSize - 4)
    snake.forEach((part, index) => {
      context.fillStyle = index === 0 ? '#62d6a3' : 'rgba(98, 214, 163, 0.55)'
      context.fillRect(part.x * cellSize + 1, part.y * cellSize + 1, cellSize - 2, cellSize - 2)
    })
    if (gameOver.value) {
      context.fillStyle = 'rgba(21,22,19,0.75)'
      context.fillRect(0, cells * cellSize / 2 - 24, cells * cellSize, 48)
      context.fillStyle = '#62d6a3'
      context.font = '16px "Microsoft YaHei UI"'
      context.textAlign = 'center'
      context.fillText('本局结束 · 得分 ' + score.value, cells * cellSize / 2, cells * cellSize / 2 + 6)
    }
  }

  keyHandler = (event) => {
    if (mode.value !== 'player') return
    const turns = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
    }
    const next = turns[event.key]
    if (next && !(next.x === -direction.x && next.y === -direction.y)) {
      event.preventDefault()
      pendingDirection = next
    }
  }
  window.addEventListener('keydown', keyHandler, { passive: false })

  tickTimer = setInterval(() => { if (!gameOver.value) { step(); draw() } }, 120)
  cleanupGame = () => {}
  draw()
}

// ── 生命周期 ──
onMounted(() => {
  secondsTimer = setInterval(() => { playSeconds.value += 1 }, 1000)
  restart()
})

onBeforeUnmount(() => {
  clearInterval(secondsTimer)
  stopLoops()
})

watch([selected, mode], () => { score.value = 0; gameOver.value = false })
</script>

<template>
  <section class="mini-games" aria-label="等待期间小游戏">
    <div class="mini-games-side">
      <div class="mini-games-title">
        <Gamepad2 :size="14" />
        <span>等待时来一局</span>
      </div>
      <div class="mini-games-switch" :class="{ locked: !unlocked }">
        <button
          v-for="game in switchChoices"
          :key="game"
          type="button"
          class="mini-games-switch-btn"
          :disabled="!unlocked"
          @click="switchGame(game)"
        >
          <RefreshCw :size="12" />
          换 {{ GAME_LABELS[game] }}
          <small v-if="!unlocked">{{ 300 - playSeconds }}s 后解锁</small>
        </button>
      </div>
      <p class="mini-games-instruction">{{ instructionText }}</p>
      <div class="mini-games-modes">
        <button
          v-for="choice in modeButtons"
          :key="choice.id"
          type="button"
          :class="{ active: mode === choice.id }"
          @click="setMode(choice.id)"
        >
          <component :is="choice.id === 'player' ? User : Bot" :size="12" />
          {{ choice.label }}
        </button>
      </div>
    </div>
    <div class="mini-games-stage">
      <canvas ref="canvasRef" class="mini-games-canvas" tabindex="0" />
      <span v-if="gameOver" class="mini-games-restart" @click="restart">
        <Play :size="12" /> 再来一局
      </span>
      <span class="mini-games-score">得分 {{ score }}</span>
    </div>
  </section>
</template>

<style scoped>
.mini-games {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 12px 14px;
  margin-top: 10px;
  border: 1px dashed var(--glass-border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.mini-games-side { flex: 1; min-width: 0; display: grid; gap: 9px; }
.mini-games-title { display: flex; align-items: center; gap: 7px; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.mini-games-switch { display: flex; flex-direction: column; gap: 6px; }
.mini-games-switch-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px;
  border: 1px solid rgba(98, 214, 163, 0.35); border-radius: 7px;
  background: rgba(98, 214, 163, 0.07); color: var(--signal);
  font-size: 11px; cursor: pointer; transition: filter 140ms ease;
}
.mini-games-switch-btn:hover:not(:disabled) { filter: brightness(1.2); }
.mini-games-switch-btn:disabled { opacity: 0.45; cursor: default; }
.mini-games-switch-btn small { color: var(--text-muted); font-size: 10px; }
.mini-games-instruction { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.7; }
.mini-games-modes { display: flex; gap: 7px; }
.mini-games-modes button {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
  border: 1px solid var(--glass-border); border-radius: 999px;
  background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer;
}
.mini-games-modes button.active { border-color: rgba(98, 214, 163, 0.5); color: var(--signal); background: rgba(98, 214, 163, 0.08); }
.mini-games-stage { position: relative; flex: 0 0 auto; }
.mini-games-canvas { display: block; border: 1px solid var(--glass-border); border-radius: 8px; background: #151613; outline: none; }
.mini-games-restart {
  position: absolute; left: 50%; bottom: 44px; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px;
  border: 1px solid rgba(98, 214, 163, 0.5); border-radius: 999px; cursor: pointer;
  background: rgba(21, 22, 19, 0.9); color: var(--signal); font-size: 11px;
}
.mini-games-score {
  position: absolute; right: 8px; top: 6px;
  color: var(--text-muted); font: 600 11px ui-monospace, Consolas, monospace;
}
@media (max-width: 620px) {
  .mini-games { flex-direction: column; }
  .mini-games-stage { align-self: center; }
}
</style>
