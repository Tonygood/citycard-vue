<template>
  <Teleport to="body">
    <div class="intercept-overlay">
      <div class="intercept-popup">
        <div class="popup-header">
          <div class="header-icon">🛡️</div>
          <h3>无懈可击</h3>
        </div>

        <div class="popup-body">
          <div class="skill-info">
            <div class="caster-line">
              <span class="player-name caster">{{ intercept.casterName }}</span>
              <span>使用了</span>
              <span class="skill-name">{{ intercept.skillName }}</span>
            </div>
            <div class="cost-line">
              技能花费：<span class="gold">{{ intercept.skillCost }}</span> 金币
            </div>
          </div>

          <div class="divider"></div>

          <div class="intercept-info">
            <p>是否使用<strong>无懈可击</strong>拦截该技能？</p>
            <p class="intercept-cost">
              拦截费用：<span class="gold">{{ intercept.interceptCost }}</span> 金币
              （当前：<span class="gold">{{ currentGold }}</span>）
            </p>
          </div>

          <div class="timer-section">
            <div class="timer-text">剩余时间：{{ remainingSeconds }}s</div>
            <div class="timer-bar">
              <div class="timer-fill" :style="{ width: timerPercent + '%' }"></div>
            </div>
            <p class="timer-hint">超时将自动放弃拦截</p>
          </div>
        </div>

        <div class="popup-actions">
          <button class="btn-accept" @click="handleAccept">
            放弃拦截
          </button>
          <button class="btn-counter" @click="handleCounter">
            使用无懈可击（{{ intercept.interceptCost }}金币）
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../../stores/gameStore'

const props = defineProps({
  currentPlayer: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['intercept-accepted', 'intercept-countered'])

const gameStore = useGameStore()

const intercept = computed(() => gameStore.pendingIntercept || {})

const currentGold = computed(() => {
  const player = gameStore.players.find(p => p.name === props.currentPlayer?.name)
  return player?.gold || 0
})

// 倒计时
const remainingSeconds = ref(45)
const timerPercent = ref(100)
let timerInterval = null

function updateTimer() {
  const data = gameStore.pendingIntercept
  if (!data) return

  const now = Date.now()
  const remaining = Math.max(0, data.expiresAt - now)
  const total = data.expiresAt - data.createdAt
  remainingSeconds.value = Math.ceil(remaining / 1000)
  timerPercent.value = Math.max(0, (remaining / total) * 100)

  if (remaining <= 0) {
    // 超时自动放弃
    handleAccept()
  }
}

onMounted(() => {
  updateTimer()
  timerInterval = setInterval(updateTimer, 1000)
})

onUnmounted(() => {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
})

function handleAccept() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  emit('intercept-accepted', JSON.parse(JSON.stringify(gameStore.pendingIntercept)))
}

function handleCounter() {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  emit('intercept-countered', JSON.parse(JSON.stringify(gameStore.pendingIntercept)))
}
</script>

<style scoped>
.intercept-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.intercept-popup {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border: 2px solid #e94560;
  border-radius: 16px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(233, 69, 96, 0.3), 0 0 40px rgba(233, 69, 96, 0.1);
  animation: popupEnter 0.3s ease-out;
}

@keyframes popupEnter {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(233, 69, 96, 0.3);
}

.header-icon {
  font-size: 28px;
}

.popup-header h3 {
  margin: 0;
  color: #e94560;
  font-size: 20px;
  font-weight: 700;
}

.popup-body {
  padding: 16px 20px;
}

.skill-info {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 12px;
}

.caster-line {
  font-size: 15px;
  color: #ccc;
  margin-bottom: 6px;
}

.player-name.caster {
  color: #ff6b6b;
  font-weight: 600;
}

.skill-name {
  color: #ffd93d;
  font-weight: 600;
}

.cost-line {
  font-size: 13px;
  color: #999;
}

.gold {
  color: #ffd93d;
  font-weight: 600;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 14px 0;
}

.intercept-info p {
  margin: 0 0 8px;
  color: #ddd;
  font-size: 15px;
}

.intercept-info strong {
  color: #e94560;
}

.intercept-cost {
  font-size: 14px;
  color: #bbb;
}

.timer-section {
  margin-top: 14px;
  text-align: center;
}

.timer-text {
  font-size: 14px;
  color: #aaa;
  margin-bottom: 6px;
}

.timer-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.timer-fill {
  height: 100%;
  background: linear-gradient(90deg, #e94560, #ff6b6b);
  border-radius: 2px;
  transition: width 1s linear;
}

.timer-hint {
  font-size: 12px;
  color: #666;
  margin: 6px 0 0;
}

.popup-actions {
  display: flex;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.popup-actions button {
  flex: 1;
  padding: 10px 8px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
}

.popup-actions button:active {
  transform: scale(0.97);
}

.btn-accept {
  background: rgba(255, 255, 255, 0.1);
  color: #aaa;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
}

.btn-accept:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ddd;
}

.btn-counter {
  background: linear-gradient(135deg, #e94560, #c62a3f);
  color: #fff;
  box-shadow: 0 4px 15px rgba(233, 69, 96, 0.4);
}

.btn-counter:hover {
  box-shadow: 0 6px 20px rgba(233, 69, 96, 0.6);
}
</style>
