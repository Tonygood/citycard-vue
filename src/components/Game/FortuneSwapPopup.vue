<template>
  <Teleport to="body">
    <div v-if="swap && isTarget" class="fortune-swap-overlay">
      <div class="fortune-swap-popup">
        <div class="popup-header">
          <div class="header-icon">🔄</div>
          <h3>{{ swap.type }}</h3>
        </div>

        <!-- 李代桃僵选城模式 -->
        <div v-if="selectingCityForLiDai" class="li-dai-selection">
          <div class="selection-header">
            <span class="selection-title">选择你要交换的城市（{{ selectedCities.length }}/{{ maxSelectCount }}）</span>
          </div>
          <div class="city-list">
            <div
              v-for="city in selectableCities"
              :key="city.name"
              :class="['city-item', { selected: selectedCities.includes(city.name) }]"
              @click="toggleCitySelection(city.name)"
            >
              <span class="city-name-text">{{ city.name }}</span>
              <span class="city-hp-text">HP: {{ city.currentHp ?? city.hp }}</span>
            </div>
          </div>
          <div class="selection-actions">
            <button class="btn-cancel-select" @click="cancelLiDai">取消</button>
            <button
              class="btn-confirm-select"
              :disabled="selectedCities.length !== maxSelectCount"
              @click="confirmLiDai"
            >
              确认交换
            </button>
          </div>
        </div>

        <!-- 正常选项模式 -->
        <div v-else class="response-section">
          <div class="swap-info">
            <div class="info-row">
              <span class="info-label">对手</span>
              <span class="info-value caster">{{ swap.casterName }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">技能</span>
              <span class="info-value">{{ swap.type }}</span>
            </div>
          </div>

          <div class="action-buttons">
            <button class="btn-accept" @click="handleAccept">
              接受交换
            </button>
            <button
              class="btn-li-dai"
              :disabled="!canUseLiDai"
              :title="liDaiDisabledReason"
              @click="startLiDaiSelection"
            >
              <span class="btn-text">李代桃僵</span>
              <span class="btn-cost">(6💰)</span>
            </button>
            <button
              class="btn-counter"
              :disabled="!canUseWuXie"
              :title="wuXieDisabledReason"
              @click="handleCounter"
            >
              <span class="btn-text">无懈可击</span>
              <span class="btn-cost">(11💰)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../../stores/gameStore'
import { SKILL_COSTS } from '../../constants/skillCosts'

const props = defineProps({
  currentPlayer: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['fortune-swap-accepted', 'fortune-swap-li-dai', 'fortune-swap-countered'])

const gameStore = useGameStore()

const selectingCityForLiDai = ref(false)
const selectedCities = ref([])

const swap = computed(() => gameStore.pendingFortuneSwap)

// 只有目标玩家才显示弹窗
const isTarget = computed(() => swap.value && swap.value.targetName === props.currentPlayer?.name)

// 时来运转选3座城市，人质交换选1座城市
const maxSelectCount = computed(() => {
  if (!swap.value) return 0
  return swap.value.type === '时来运转' ? 3 : 1
})

// 可选城市列表（排除中心城市、谨慎交换集合、定海神针、钢铁城市、保护罩城市）
const selectableCities = computed(() => {
  if (!props.currentPlayer) return []
  const playerName = props.currentPlayer.name
  const player = gameStore.players.find(p => p.name === playerName)
  if (!player) return []

  const cities = []
  Object.entries(player.cities).forEach(([cityName, city]) => {
    if (city.isAlive === false) return
    if (city.isCenter || cityName === player.centerCityName) return
    if (gameStore.isInCautiousSet(playerName, cityName)) return
    if (gameStore.anchored[playerName] && gameStore.anchored[playerName][cityName]) return
    if (gameStore.hasIronShield && gameStore.hasIronShield(playerName, cityName)) return
    if (gameStore.hasProtection && gameStore.hasProtection(playerName, cityName)) return
    cities.push({ name: cityName, currentHp: city.currentHp, hp: city.hp })
  })
  return cities
})

// 是否可以使用李代桃僵
const canUseLiDai = computed(() => {
  if (!props.currentPlayer) return false
  const name = props.currentPlayer.name
  if (props.currentPlayer.gold < 6) return false
  if (gameStore.bannedSkills?.[name]?.['李代桃僵']) return false
  if (gameStore.cooldowns?.[name]?.['李代桃僵'] > 0) return false
  const skillMeta = SKILL_COSTS['李代桃僵']
  if (skillMeta && skillMeta.limit > 0 && gameStore.getSkillUsageCount(name, '李代桃僵') >= skillMeta.limit) return false
  return true
})

const liDaiDisabledReason = computed(() => {
  if (!props.currentPlayer) return ''
  const name = props.currentPlayer.name
  if (props.currentPlayer.gold < 6) return `金币不足（需要6，当前${props.currentPlayer.gold}）`
  if (gameStore.bannedSkills?.[name]?.['李代桃僵']) return '李代桃僵已被事半功倍禁用'
  if (gameStore.cooldowns?.[name]?.['李代桃僵'] > 0) return `李代桃僵冷却中（剩余${gameStore.cooldowns[name]['李代桃僵']}回合）`
  const skillMeta = SKILL_COSTS['李代桃僵']
  if (skillMeta && skillMeta.limit > 0 && gameStore.getSkillUsageCount(name, '李代桃僵') >= skillMeta.limit) return `李代桃僵已达使用上限（${skillMeta.limit}次）`
  return ''
})

// 是否可以使用无懈可击
const canUseWuXie = computed(() => {
  if (!props.currentPlayer) return false
  const name = props.currentPlayer.name
  if (props.currentPlayer.gold < 11) return false
  if (gameStore.bannedSkills?.[name]?.['无懈可击']) return false
  if (gameStore.cooldowns?.[name]?.['无懈可击'] > 0) return false
  return true
})

const wuXieDisabledReason = computed(() => {
  if (!props.currentPlayer) return ''
  const name = props.currentPlayer.name
  if (props.currentPlayer.gold < 11) return `金币不足（需要11，当前${props.currentPlayer.gold}）`
  if (gameStore.bannedSkills?.[name]?.['无懈可击']) return '无懈可击已被事半功倍禁用'
  if (gameStore.cooldowns?.[name]?.['无懈可击'] > 0) return `无懈可击冷却中（剩余${gameStore.cooldowns[name]['无懈可击']}回合）`
  return ''
})

function handleAccept() {
  emit('fortune-swap-accepted', swap.value)
}

function startLiDaiSelection() {
  if (!canUseLiDai.value) return
  selectingCityForLiDai.value = true
  selectedCities.value = []
}

function toggleCitySelection(cityName) {
  const idx = selectedCities.value.indexOf(cityName)
  if (idx >= 0) {
    selectedCities.value.splice(idx, 1)
  } else if (selectedCities.value.length < maxSelectCount.value) {
    selectedCities.value.push(cityName)
  }
}

function cancelLiDai() {
  selectingCityForLiDai.value = false
  selectedCities.value = []
}

function confirmLiDai() {
  if (selectedCities.value.length !== maxSelectCount.value) return
  emit('fortune-swap-li-dai', { ...swap.value, selectedCities: [...selectedCities.value] })
  selectingCityForLiDai.value = false
  selectedCities.value = []
}

function handleCounter() {
  if (!canUseWuXie.value) return
  emit('fortune-swap-countered', swap.value)
}
</script>

<style scoped>
.fortune-swap-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.fortune-swap-popup {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border: 2px solid #4ecdc4;
  border-radius: 16px;
  width: 420px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(78, 205, 196, 0.3), 0 0 40px rgba(78, 205, 196, 0.1);
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
  border-bottom: 1px solid rgba(78, 205, 196, 0.3);
}

.header-icon {
  font-size: 28px;
}

.popup-header h3 {
  margin: 0;
  color: #4ecdc4;
  font-size: 20px;
  font-weight: 700;
}

/* 正常选项模式 */
.response-section {
  padding: 16px 20px;
}

.swap-info {
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 10px;
  padding: 14px 18px;
  color: #3b82f6;
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}

.info-label {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
  min-width: 40px;
}

.info-value {
  color: #eee;
  font-weight: 600;
}

.info-value.caster {
  color: #ff6b6b;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-buttons button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.action-buttons button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-accept {
  background: linear-gradient(135deg, #4ecdc4, #2eb5a8);
  color: white;
}

.btn-accept:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(78, 205, 196, 0.4);
}

.btn-li-dai {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.15), rgba(255, 215, 0, 0.08));
  border: 1px solid rgba(255, 215, 0, 0.3) !important;
  color: #ffd93d;
}

.btn-li-dai:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.25), rgba(255, 215, 0, 0.15));
}

.btn-counter {
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.15), rgba(233, 69, 96, 0.08));
  border: 1px solid rgba(233, 69, 96, 0.3) !important;
  color: #e94560;
}

.btn-counter:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(233, 69, 96, 0.25), rgba(233, 69, 96, 0.15));
}

.btn-cost {
  font-size: 13px;
  opacity: 0.8;
}

/* 李代桃僵选城模式 */
.li-dai-selection {
  padding: 16px 20px;
}

.selection-header {
  margin-bottom: 12px;
}

.selection-title {
  color: #ffd93d;
  font-size: 14px;
  font-weight: 600;
}

.city-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 14px;
}

.city-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.city-item:hover {
  background: rgba(255, 215, 0, 0.06);
  border-color: rgba(255, 215, 0, 0.2);
}

.city-item.selected {
  background: rgba(255, 215, 0, 0.12);
  border-color: #ffd93d;
}

.city-name-text {
  color: #eee;
  font-weight: 600;
  font-size: 14px;
}

.city-hp-text {
  color: #999;
  font-size: 12px;
}

.selection-actions {
  display: flex;
  gap: 10px;
}

.selection-actions button {
  flex: 1;
  padding: 10px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel-select {
  background: rgba(255, 255, 255, 0.1);
  color: #aaa;
}

.btn-cancel-select:hover {
  background: rgba(255, 255, 255, 0.15);
}

.btn-confirm-select {
  background: linear-gradient(135deg, #ffd93d, #e6b800);
  color: #1a1a2e;
}

.btn-confirm-select:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
