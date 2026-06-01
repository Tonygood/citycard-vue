<template>
  <div id="playerMode">
    <div class="player-container">
      <!-- Firebase配置步骤 -->
      <FirebaseConfig
        v-if="currentStep === 'firebase-config'"
        @initialized="handleFirebaseInitialized"
        @skip="handleFirebaseSkip"
      />

      <!-- 房间选择步骤 -->
      <RoomSelection
        v-if="currentStep === 'room-selection'"
        @room-created="handleRoomCreated"
        @room-joined="handleRoomJoined"
        @back="$emit('exit')"
      />

      <!-- 等待房间步骤 -->
      <WaitingRoom
        v-if="currentStep === 'waiting-room'"
        :room-id="currentRoomId"
        :force-spectator="forceSpectator"
        :initial-room-data="initialRoomData"
        :reconnected-player-name="waitingRoomReconnectName"
        @all-ready="handleAllReady"
        @player-joined="handlePlayerJoined"
        @reconnect-to-game="handleMidGameReconnect"
      />

      <!-- 选择中心城市步骤 -->
      <CenterCitySelection
        v-if="currentStep === 'center-city-selection'"
        :player-name="currentPlayer?.name || ''"
        :cities="currentPlayer?.cities ? Object.values(currentPlayer.cities) : []"
        :initial-center-name="centerCityName"
        :current-draw-count="playerDrawCount"
        :game-mode="gameMode"
        @center-selected="handleCenterSelected"
        @confirm="handleCenterConfirmed"
        @redraw="handleRedrawCities"
      />

      <!-- 等待其他玩家确认 -->
      <div v-if="currentStep === 'waiting-for-center-confirmation'" class="game-waiting-area">
        <div class="waiting-content">
          <div class="waiting-icon">⏳</div>
          <h3>{{ gameMode === '3P' ? '等待其他玩家确认城市...' : '等待其他玩家确认中心城市...' }}</h3>
          <p class="waiting-hint">{{ gameMode === '3P' ? '你已确认城市，请耐心等待' : '你已完成中心城市选择，请耐心等待' }}</p>
        </div>
      </div>

      <!-- 城市部署步骤 -->
      <CityDeployment
        v-if="currentStep === 'city-deployment'"
        :current-player="currentPlayer"
        :game-mode="gameMode"
        :all-players="gameStore.players"
        :room-id="currentRoomId"
        @deployment-confirmed="handleDeploymentConfirmed"
        @skill-used="handleSkillSelected"
        @exit-room="handleExit"
        @surrender="handleSurrender"
        @request-draw="handleRequestDraw"
      />

      <!-- 游戏进行中 - 战斗会自动在后台进行，玩家通过日志查看 -->
      <!-- 战斗完成后会自动返回部署界面 -->
      <div v-if="currentStep === 'game'" class="game-waiting-area">
        <div class="waiting-content">
          <div class="waiting-icon">⚔️</div>
          <h3>战斗计算中...</h3>
          <p class="waiting-hint">请查看右侧战斗日志</p>
          <GameLogSimple :current-player-name="currentPlayer?.name" />
        </div>
      </div>
    </div>

    <!-- 战斗动画 -->
    <BattleAnimation
      :show="showBattleAnimation"
      :battle-data="battleAnimationData"
      @complete="handleBattleAnimationComplete"
    />

    <!-- 断线重连弹窗 -->
    <ReconnectModal
      v-model="showReconnectModal"
      :player-name="reconnectPlayerName"
      :room-id="currentRoomId"
      @reconnect="handleReconnect"
      @cancel="handleReconnectCancel"
    />

    <!-- 游戏日志模态框（仅在非game步骤显示） -->
    <GameLog v-if="currentStep !== 'game'" :show="showLog" @close="showLog = false" />

    <!-- 技能选择模态框 -->
    <SkillSelector
      v-if="showSkillSelector"
      :current-player="currentPlayer"
      @close="showSkillSelector = false"
      @skill-used="handleSkillSelected"
      @skill-failed="handleSkillFailed"
    />

    <!-- 先声夺人待处理请求面板 -->
    <PendingSwapsPanel
      v-if="currentPlayer && (currentStep === 'city-deployment' || currentStep === 'game')"
      :current-player="currentPlayer"
      @swap-accepted="handleSwapAccepted"
      @swap-rejected="handleSwapRejected"
    />

    <!-- 无懈可击拦截弹窗（Player B收到） -->
    <InterceptPopup
      v-if="currentPlayer && gameStore.pendingIntercept && gameStore.pendingIntercept.status === 'pending' && gameStore.pendingIntercept.targetName === currentPlayer.name"
      :current-player="currentPlayer"
      @intercept-accepted="handleInterceptAccepted"
      @intercept-countered="handleInterceptCountered"
    />

    <!-- 时来运转/人质交换弹窗（仅目标玩家收到，施法者不显示） -->
    <FortuneSwapPopup
      v-if="currentPlayer && gameStore.pendingFortuneSwap && gameStore.pendingFortuneSwap.status === 'pending' && gameStore.pendingFortuneSwap.targetName === currentPlayer.name"
      :current-player="currentPlayer"
      @fortune-swap-accepted="handleFortuneSwapAccepted"
      @fortune-swap-li-dai="handleFortuneSwapLiDai"
      @fortune-swap-countered="handleFortuneSwapCountered"
    />

    <!-- 博学多才答题弹窗 -->
    <Teleport to="body">
      <div v-if="bxdcShow" class="bxdc-overlay">
        <div class="bxdc-modal">
          <template v-if="!bxdcFinished">
            <div class="bxdc-header">
              <span class="bxdc-progress">第 {{ bxdcCurrentIndex + 1 }} / {{ bxdcQuestions.length }} 题</span>
              <span class="bxdc-difficulty">{{ bxdcQuestions[bxdcCurrentIndex]?.difficulty }}</span>
              <span class="bxdc-timer" :class="{ 'timer-warn': bxdcTimeLeft <= 3 }">{{ bxdcTimeLeft }}s</span>
            </div>
            <div class="bxdc-question">{{ bxdcQuestions[bxdcCurrentIndex]?.question }}</div>
            <div class="bxdc-options">
              <button
                v-for="(opt, idx) in bxdcQuestions[bxdcCurrentIndex]?.options"
                :key="idx"
                class="bxdc-option"
                :class="{
                  'correct': bxdcAnswered && opt[0] === bxdcQuestions[bxdcCurrentIndex]?.answer,
                  'wrong': bxdcAnswered && bxdcSelectedAnswer === opt[0] && opt[0] !== bxdcQuestions[bxdcCurrentIndex]?.answer,
                  'selected': bxdcSelectedAnswer === opt[0]
                }"
                :disabled="bxdcAnswered"
                @click="selectBxdcAnswerPM(opt[0])"
              >
                {{ opt }}
              </button>
            </div>
            <div v-if="bxdcAnswered && !bxdcSelectedAnswer" class="bxdc-timeout">超时未答！</div>
          </template>
          <template v-else>
            <div class="bxdc-result">
              <h3>答题完成！</h3>
              <div class="bxdc-score">答对 {{ bxdcCorrectCount }} / {{ bxdcQuestions.length }} 题</div>
              <div class="bxdc-multiplier">HP倍率：x{{ [1, 1.25, 1.75, 2.5][bxdcCorrectCount] || 1 }}</div>
              <button class="bxdc-confirm" @click="confirmBxdcResultPM">确认</button>
            </div>
          </template>
        </div>
      </div>
    </Teleport>

    <!-- 无懈可击等待遮罩（Player A等待对手响应） -->
    <div v-if="waitingForIntercept" class="intercept-waiting-overlay">
      <div class="intercept-waiting-content">
        <div class="waiting-icon">⏳</div>
        <h3>等待对手响应...</h3>
        <p class="waiting-hint">对手正在决定是否使用无懈可击（{{ interceptWaitSeconds }}秒）</p>
        <div class="waiting-progress-bar">
          <div class="waiting-progress-fill" :style="{ width: interceptWaitPercent + '%' }"></div>
        </div>
      </div>
    </div>

    <!-- 时来运转/人质交换等待遮罩（Player A等待对手响应） -->
    <div v-if="waitingForFortuneSwap" class="intercept-waiting-overlay">
      <div class="intercept-waiting-content">
        <div class="waiting-icon">🔄</div>
        <h3>等待对手响应...</h3>
        <p class="waiting-hint">对手正在决定是否接受交换</p>
      </div>
    </div>

    <!-- 求和请求面板 -->
    <DrawRequestPanel
      v-if="currentPlayer && (currentStep === 'city-deployment' || currentStep === 'game')"
      :current-player="currentPlayer"
      @draw-accepted="handleDrawAccepted"
      @draw-rejected="handleDrawRejected"
    />

    <!-- 技能失败提示弹窗 -->
    <div v-if="showSkillFailureModal" class="skill-failure-modal" @click.self="closeSkillFailureModal">
      <div class="skill-failure-content">
        <div class="skill-failure-header">
          <span class="skill-failure-icon">❌</span>
          <h3 class="skill-failure-title">技能使用失败</h3>
        </div>
        <div class="skill-failure-body">
          <div class="skill-failure-skill">
            <span class="label">技能名称：</span>
            <span class="value">{{ skillFailureInfo?.skillName }}</span>
          </div>
          <div class="skill-failure-reason">
            <span class="label">失败原因：</span>
            <span class="value">{{ skillFailureInfo?.message }}</span>
          </div>
        </div>
        <div class="skill-failure-footer">
          <button class="skill-failure-btn" @click="closeSkillFailureModal">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- 强制选择新中心城市（强制转移等技能触发） -->
    <div v-if="showNewCenterSelection" class="new-center-modal">
      <div class="new-center-content">
        <div class="new-center-header">
          <span class="new-center-icon">🏛️</span>
          <h3 class="new-center-title">选择新的中心城市</h3>
        </div>
        <p class="new-center-reason">
          因对手使用了【{{ newCenterReason }}】，你的中心城市已被淘汰，请选择新的中心城市。
        </p>
        <div class="new-center-cities">
          <div
            v-for="[cityName, city] in aliveCitiesForNewCenter"
            :key="cityName"
            class="new-center-city-card"
            :class="{ 'selected': newCenterSelected === cityName }"
            @click="newCenterSelected = cityName"
          >
            <strong>{{ city.name }}</strong>
            <div class="new-center-city-hp">
              HP: {{ Math.floor(city.currentHp !== undefined ? city.currentHp : city.hp) }}
            </div>
          </div>
        </div>
        <button
          class="new-center-confirm-btn"
          :disabled="!newCenterSelected"
          @click="confirmNewCenter"
        >
          确认选择
        </button>
      </div>
    </div>

    <!-- 胜利/失败模态框 -->
    <div v-if="showVictory && gameLogic?.isGameOver?.value" class="victory-modal">
      <div class="victory-content">
        <div class="victory-animation">
          <div class="trophy">{{ gameLogic.winner.value ? '🏆' : '🤝' }}</div>
        </div>
        <h2 class="victory-title">
          {{ gameLogic.winner.value ? gameLogic.winner.value.name + ' 获得胜利！' : '平局！' }}
        </h2>
        <div class="victory-round-badge">第 {{ gameStore.currentRound }} 回合结束</div>

        <!-- 所有玩家结算 -->
        <div class="victory-players">
          <div
            v-for="(player, idx) in gameStore.players"
            :key="idx"
            class="victory-player"
            :class="{ 'is-winner': gameLogic.winner.value && player.name === gameLogic.winner.value?.name }"
          >
            <div class="vp-header">
              <span class="vp-rank">{{ gameLogic.winner.value ? (player.name === gameLogic.winner.value?.name ? '👑' : '💀') : '⚔️' }}</span>
              <span class="vp-name">{{ player.name }}</span>
              <span class="vp-gold">{{ player.gold || 0 }} 金币</span>
            </div>
            <div class="vp-cities">
              <div
                v-for="[cityName, city] in Object.entries(player.cities || {})"
                :key="cityName"
                class="vp-city"
                :class="{ 'city-dead': city.isAlive === false || (city.currentHp !== undefined ? city.currentHp : city.hp) <= 0 }"
              >
                <span class="vp-city-name">{{ city.name }}</span>
                <span class="vp-city-hp">{{ Math.floor(city.currentHp !== undefined ? city.currentHp : city.hp) }}</span>
              </div>
            </div>
            <div v-if="gameStore.skillUsageTracking[player.name] && Object.keys(gameStore.skillUsageTracking[player.name]).length > 0" class="vp-skills">
              <div class="vp-skills-title">技能使用</div>
              <div class="vp-skills-list">
                <span
                  v-for="(count, skillName) in gameStore.skillUsageTracking[player.name]"
                  :key="skillName"
                  class="vp-skill-item"
                >{{ skillName }} {{ count }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="victory-actions">
          <button class="victory-btn victory-btn--restart" @click="restartGame">
            再来一局
          </button>
          <button class="victory-btn victory-btn--exit" @click="handleExit">
            返回主菜单
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useGameStore } from '../../stores/gameStore'
import { useDialog } from '../../composables/useDialog'
import { autoInitFirebase } from '../../composables/useFirebase'
import { useRoom } from '../../composables/useRoom'
import { useGameLogic } from '../../composables/useGameLogic'
import { useCityDraw } from '../../composables/useCityDraw'
import { debugLog } from '../../utils/debug'
import { useSession } from '../../composables/useSession'
import { addSkillUsageLog, addSkillEffectLog } from '../../composables/game/logUtils'
import { SKILL_COSTS, getInterceptCost, getActualSkillCost } from '../../constants/skillCosts'
import { CITY_QUESTIONS, hasCityQuestions } from '../../data/cityQuestions'
import { PROVINCE_MAP } from '../../data/cities'
import { getProvinceName } from '../../utils/cityHelpers'
import FirebaseConfig from '../Firebase/FirebaseConfig.vue'
import RoomSelection from '../Room/RoomSelection.vue'
import WaitingRoom from '../Room/WaitingRoom.vue'
import CenterCitySelection from './CenterCitySelection.vue'
import CityDeployment from '../Game/CityDeployment.vue'
import GameLog from '../Game/GameLog.vue'
import GameLogSimple from '../Game/GameLogSimple.vue'
import SkillSelector from '../Skills/SkillSelector.vue'
import PendingSwapsPanel from '../Game/PendingSwapsPanel.vue'
import InterceptPopup from '../Game/InterceptPopup.vue'
import FortuneSwapPopup from '../Game/FortuneSwapPopup.vue'
import DrawRequestPanel from '../Game/DrawRequestPanel.vue'
import BattleAnimation from '../Game/BattleAnimation.vue'
import ReconnectModal from '../Modals/ReconnectModal.vue'

const emit = defineEmits(['exit'])

const gameStore = useGameStore()
const { showAlert, showConfirm } = useDialog()
const { leaveRoom, getRoomData, saveRoomData, updateRoomGameState, startRoomListener, stopRoomListener, startHeartbeat, stopHeartbeat, addPlayerToRoom } = useRoom()
const gameLogic = useGameLogic()
const { drawCities, getUsedNames } = useCityDraw()
const { saveSession, loadSession, clearSession, setupBeforeUnloadPersistence } = useSession()

// 步骤: firebase-config, room-selection, waiting-room, center-city-selection, game
const currentStep = ref('firebase-config')
const currentRoomId = ref('')
const forceSpectator = ref(false)
const initialRoomData = ref(null)
const showLog = ref(false)
const showSkillSelector = ref(false)
const showVictory = ref(false)
const currentPlayer = ref(null)
const gameMode = ref('2P')
const centerCityName = ref(null)
const playerDrawCount = ref(1)
const isBattleProcessing = ref(false)  // 防止战斗处理被重复调用
const battleRetryCount = ref(0)        // 战斗重试计数器（防止无限循环）
const BATTLE_MAX_RETRIES = 2           // 最大重试次数
const showBattleAnimation = ref(false)  // 控制战斗动画显示
const animationShownForRound = ref(-1)  // 记录已显示动画的回合号，防止同回合重复显示

// 博学多才答题状态
const bxdcShow = ref(false)
const bxdcQuestions = ref([])
const bxdcCurrentIndex = ref(0)
const bxdcCorrectCount = ref(0)
const bxdcTimeLeft = ref(12)
const bxdcTimer = ref(null)
const bxdcAnswered = ref(false)
const bxdcSelectedAnswer = ref(null)
const bxdcFinished = ref(false)
let bxdcResolve = null  // Promise resolver for async quiz
const battleAnimationData = ref(null)   // 战斗动画数据
const isFirstPlayerInRoom = ref(false)  // 当前玩家是否为房间第一个玩家
const showSkillFailureModal = ref(false)  // 控制技能失败弹窗显示
const skillFailureInfo = ref(null)       // 技能失败信息
const showNewCenterSelection = ref(false) // 强制选择新中心城市弹窗
const newCenterSelected = ref('')         // 用户选择的新中心城市名
const newCenterReason = ref('')           // 触发原因（如"强制转移·普通"）
const showReconnectModal = ref(false)    // 断线重连弹窗
const reconnectPlayerName = ref('')      // 重连玩家昵称
const reconnectSession = ref(null)       // 重连会话数据
const waitingRoomReconnectName = ref('') // 传给WaitingRoom的重连昵称
const waitingForIntercept = ref(false)   // Player A是否正在等待对手响应无懈可击
const interceptWaitSeconds = ref(0)      // 等待剩余秒数
const interceptWaitPercent = ref(100)    // 等待进度百分比
let interceptWaitTimer = null            // 等待计时器
let executingPendingSkill = false        // 防止executePendingSkill重复执行
const waitingForFortuneSwap = ref(false) // Player A是否正在等待对手响应时来运转/人质交换
let roomDataListener = null

/**
 * Determine which step to restore to based on session + room state
 */
function determineRestorationStep(session, roomData, playerData) {
  if (!roomData || !playerData) return 'room-selection'

  const hasGameState = roomData.gameState && roomData.gameState.playerStates
  const playerState = hasGameState ? roomData.gameState.playerStates[playerData.name] : null

  // Has cities deployed (playerState with battle cities) → city-deployment
  if (hasGameState && playerState) {
    // Game is active, restore to city-deployment
    return 'city-deployment'
  }

  // Player has a center city selected and confirmed (ready=true) → waiting-for-center-confirmation or city-deployment
  if (playerData.centerCityName) {
    const allPlayersReady = roomData.players.every(p => p.ready === true)
    if (allPlayersReady) {
      return 'city-deployment'
    }
    return 'waiting-for-center-confirmation'
  }

  // Player has cities assigned but no center yet → center-city-selection
  if (playerData.cities && Object.keys(playerData.cities).length > 0) {
    return 'center-city-selection'
  }

  // Otherwise → waiting-room
  return 'waiting-room'
}

onMounted(async () => {
  // 设置关闭标签页时将session持久化到localStorage（用于跨标签页恢复）
  setupBeforeUnloadPersistence()

  // 尝试自动初始化Firebase
  const initialized = autoInitFirebase()
  if (initialized) {
    // Skip firebase-config immediately (synchronous) so the config screen never flashes
    currentStep.value = 'room-selection'

    // Then check for saved session to restore (async)
    const session = loadSession()
    if (session) {
      debugLog('[PlayerMode] Found saved session, attempting restore:', session)
      try {
        const roomData = await getRoomData(session.roomId)
        if (roomData) {
          // Validate player still exists in room
          const playerData = roomData.players?.find(p => p.name === session.playerName)
          if (playerData) {
            debugLog('[PlayerMode] Session valid, restoring...')
            normalizePlayerCities(playerData)

            // Restore state
            currentRoomId.value = session.roomId
            currentPlayer.value = JSON.parse(JSON.stringify(playerData))
            gameMode.value = session.gameMode || roomData.mode || '2P'
            centerCityName.value = session.centerCityName || playerData.centerCityName || null

            // Re-add player to room (refresh heartbeat entry) and start heartbeat
            await addPlayerToRoom(session.roomId, { name: session.playerName }, false)
            startHeartbeat(session.roomId, session.playerName)

            // Determine which step to restore to
            const targetStep = determineRestorationStep(session, roomData, playerData)
            debugLog('[PlayerMode] Restoring to step:', targetStep)

            // Sync room data to game store if we're past waiting-room
            if (['center-city-selection', 'waiting-for-center-confirmation', 'city-deployment', 'game'].includes(targetStep)) {
              // Normalize all players' cities
              roomData.players?.forEach(p => normalizePlayerCities(p))
              syncRoomDataToGameStore(roomData)
            }

            // Start room data listener if we're past center selection
            if (['waiting-for-center-confirmation', 'city-deployment', 'game'].includes(targetStep)) {
              startRoomDataListener()
            }

            currentStep.value = targetStep
            return
          } else {
            debugLog('[PlayerMode] Player not found in room, clearing session')
            clearSession()
          }
        } else {
          debugLog('[PlayerMode] Room not found, clearing session')
          clearSession()
        }
      } catch (e) {
        console.warn('[PlayerMode] Session restore failed:', e)
        clearSession()
      }
    }
    // No session or restore failed → already at room-selection
  }
})

// Auto-save session on every step transition
watch(currentStep, (newStep) => {
  if (currentRoomId.value && currentPlayer.value?.name) {
    saveSession({
      roomId: currentRoomId.value,
      playerName: currentPlayer.value.name,
      currentStep: newStep,
      gameMode: gameMode.value,
      centerCityName: centerCityName.value
    })
  }
})

/**
 * Handle reconnect from ReconnectModal
 */
async function handleReconnect() {
  const session = reconnectSession.value
  if (!session) return

  debugLog('[PlayerMode] Reconnecting with session:', session)
  showReconnectModal.value = false

  try {
    const roomData = await getRoomData(session.roomId)
    if (!roomData) {
      console.warn('[PlayerMode] Room no longer exists')
      clearSession()
      return
    }

    const playerData = roomData.players?.find(p => p.name === session.playerName)
    if (!playerData) {
      console.warn('[PlayerMode] Player no longer in room')
      clearSession()
      return
    }

    normalizePlayerCities(playerData)
    roomData.players?.forEach(p => normalizePlayerCities(p))

    // Restore state
    currentPlayer.value = JSON.parse(JSON.stringify(playerData))
    gameMode.value = session.gameMode || roomData.mode || '2P'
    centerCityName.value = session.centerCityName || playerData.centerCityName || null

    // Re-add player to room (refresh heartbeat entry)
    await addPlayerToRoom(session.roomId, { name: session.playerName }, false)
    startHeartbeat(session.roomId, session.playerName)

    // Determine and restore step
    const targetStep = determineRestorationStep(session, roomData, playerData)
    debugLog('[PlayerMode] Reconnect restoring to step:', targetStep)

    if (['center-city-selection', 'waiting-for-center-confirmation', 'city-deployment', 'game'].includes(targetStep)) {
      syncRoomDataToGameStore(roomData)
    }
    if (['waiting-for-center-confirmation', 'city-deployment', 'game'].includes(targetStep)) {
      startRoomDataListener()
    }

    currentStep.value = targetStep
  } catch (e) {
    console.error('[PlayerMode] Reconnect failed:', e)
    clearSession()
  }
}

/**
 * Handle cancel from ReconnectModal - continue normal join flow
 */
function handleReconnectCancel() {
  showReconnectModal.value = false
  reconnectSession.value = null
  clearSession()
  // Continue normal waiting-room flow
  currentStep.value = 'waiting-room'
}

/**
 * Firebase初始化完成
 */
function handleFirebaseInitialized() {
  currentStep.value = 'room-selection'
}

/**
 * 跳过Firebase配置（使用本地模式）
 */
function handleFirebaseSkip() {
  currentStep.value = 'room-selection'
}

/**
 * 规范化玩家cities对象的键
 * Firebase可能将城市名称键对象转为数组或数字键对象，需要统一转换为城市名称键
 */
function normalizePlayerCities(player) {
  if (!player || !player.cities) return
  if (Array.isArray(player.cities)) {
    const citiesObj = {}
    player.cities.forEach(city => {
      if (city && city.name) citiesObj[city.name] = city
    })
    player.cities = citiesObj
  } else if (typeof player.cities === 'object') {
    const keys = Object.keys(player.cities)
    const hasNumericKeys = keys.length > 0 && keys.every(k => !isNaN(k) && k !== '')
    if (hasNumericKeys) {
      const citiesObj = {}
      Object.values(player.cities).forEach(city => {
        if (city && city.name) citiesObj[city.name] = city
      })
      player.cities = citiesObj
    }
  }

  // 修正numeric centerCityName
  if (player.centerCityName !== null && player.centerCityName !== undefined) {
    const ccn = player.centerCityName
    if ((typeof ccn === 'number' || (typeof ccn === 'string' && !isNaN(ccn) && ccn !== '')) && !player.cities[ccn]) {
      const cityNames = Object.keys(player.cities)
      const idx = Number(ccn)
      if (idx >= 0 && idx < cityNames.length) {
        player.centerCityName = cityNames[idx]
        debugLog(`[normalizePlayerCities] 修正centerCityName: ${ccn} → ${player.centerCityName}`)
      }
    }
  }
}

/**
 * 房间创建完成
 */
function handleRoomCreated(roomId) {
  currentRoomId.value = roomId
  currentStep.value = 'waiting-room'
}

/**
 * 加入房间完成
 */
function handleRoomJoined({ roomId, roomData, isRoomFull, reconnectInfo }) {
  currentRoomId.value = roomId
  forceSpectator.value = isRoomFull
  initialRoomData.value = roomData
  gameMode.value = roomData.mode || '2P'

  // If reconnect info is present, show reconnect modal
  if (reconnectInfo) {
    debugLog('[PlayerMode] Reconnect info detected:', reconnectInfo)
    reconnectPlayerName.value = reconnectInfo.playerName
    reconnectSession.value = {
      roomId,
      playerName: reconnectInfo.playerName,
      savedStep: reconnectInfo.savedStep,
      gameMode: reconnectInfo.gameMode,
      centerCityName: reconnectInfo.centerCityName
    }
    showReconnectModal.value = true
    // Also go to waiting-room so it's visible behind the modal
    waitingRoomReconnectName.value = ''
    currentStep.value = 'waiting-room'
    return
  }

  currentStep.value = 'waiting-room'
}

/**
 * 所有玩家准备完毕
 */
async function handleAllReady(players) {
  debugLog('[PlayerMode] 所有玩家已准备，开始游戏流程', players)

  // 从房间数据中获取当前玩家的完整信息
  const roomData = await getRoomData(currentRoomId.value)
  if (roomData) {
    // 规范化所有玩家的cities键（Firebase可能返回数字键）
    roomData.players?.forEach(p => normalizePlayerCities(p))
    const playerData = roomData.players.find(p => p.name === currentPlayer.value?.name)
    if (playerData) {
      // 检查玩家是否有城市（重新加入的玩家可能没有城市）
      const playerCities = (playerData.cities && typeof playerData.cities === 'object' && !Array.isArray(playerData.cities))
        ? playerData.cities : {}
      if (Object.keys(playerCities).length === 0) {
        console.warn('[PlayerMode] handleAllReady - 玩家没有城市，等待城市分配')
        return
      }

      // Mid-game reconnection detection: if gameState already has active playerStates
      // with data, the game is past center-city-selection. Skip the reset and go directly
      // to city-deployment instead of forcing center re-selection.
      const existingGameState = roomData.gameState
      if (existingGameState && existingGameState.playerStates) {
        const psKeys = Object.keys(existingGameState.playerStates)
        const hasActiveGame = psKeys.length > 0 && playerData.centerCityName
        if (hasActiveGame) {
          debugLog('[PlayerMode] handleAllReady - 检测到游戏已在进行中（mid-game reconnection），跳过中心城市选择')
          currentPlayer.value = JSON.parse(JSON.stringify(playerData))
          gameMode.value = roomData.mode || '2P'
          centerCityName.value = playerData.centerCityName
          roomData.players?.forEach(p => normalizePlayerCities(p))
          syncRoomDataToGameStore(roomData)
          startRoomDataListener()
          currentStep.value = 'city-deployment'
          return
        }
      }

      debugLog('[PlayerMode] ===== BUG 6 诊断: handleAllReady =====')
      debugLog('[PlayerMode] 玩家名称:', playerData.name)
      debugLog('[PlayerMode] 城市数量:', Object.keys(playerCities).length)
      debugLog('[PlayerMode] 城市列表:')
      Object.entries(playerCities).forEach(([cityName, city]) => {
        debugLog(`  ${cityName}: ${city.name} (HP: ${city.hp})`)
      })
      debugLog('[PlayerMode] centerCityName (from Firebase):', playerData.centerCityName)
      debugLog('[PlayerMode] 这是用户将在选择界面看到的初始城市列表')
      debugLog('[PlayerMode] ========================================')

      // 初始化currentPlayer - 关键修复：深度克隆以避免引用共享
      currentPlayer.value = JSON.parse(JSON.stringify(playerData))
      debugLog('[PlayerMode] currentPlayer已深度克隆，独立于roomData')
      gameMode.value = roomData.mode || '2P'

      // 关键修复：重置所有玩家的ready标志为false，准备进入中心城市选择
      // 这样在handleCenterConfirmed中检查时，只有确认了中心城市的玩家ready才会是true
      roomData.players.forEach(player => {
        player.ready = false
      })

      // 关键修复：初始化gameState（如果不存在）
      // 必须在这里初始化，确保后续的监听器和战斗检查能正确访问
      // 注意：Firebase的set()会过滤掉空对象{}，所以需要用非空值初始化

      // 关键修复：检测空的playerStates（旧数据），强制重新初始化
      const needsInitialization = !roomData.gameState ||
                                   !roomData.gameState.playerStates ||
                                   (typeof roomData.gameState.playerStates === 'object' &&
                                    Object.keys(roomData.gameState.playerStates).length === 0)

      if (needsInitialization) {
        debugLog('[PlayerMode] ===== 初始化/修复gameState =====')
        debugLog('[PlayerMode] 原因:', !roomData.gameState ? '不存在' : 'playerStates为空对象')
        debugLog('[PlayerMode] roomData存在:', !!roomData)
        debugLog('[PlayerMode] roomData.players存在:', !!roomData.players)
        debugLog('[PlayerMode] roomData.players类型:', typeof roomData.players)
        debugLog('[PlayerMode] roomData.players是否为数组:', Array.isArray(roomData.players))
        debugLog('[PlayerMode] roomData.players数量:', roomData.players?.length)
        debugLog('[PlayerMode] roomData.players完整内容:', JSON.stringify(roomData.players, null, 2))

        // 为每个玩家初始化playerState
        const playerStates = {}

        if (!roomData.players || roomData.players.length === 0) {
          console.error('[PlayerMode] ❌ 错误：roomData.players为空，无法初始化playerStates')
          console.error('[PlayerMode] 这不应该发生！handleAllReady应该在玩家加入后才调用')
        } else {
          debugLog('[PlayerMode] 开始构建playerStates，循环次数:', roomData.players.length)
          roomData.players.forEach((player, idx) => {
            debugLog(`[PlayerMode] 处理玩家 #${idx}:`, player)
            if (!player || !player.name) {
              console.error(`[PlayerMode] ❌ 玩家${idx}没有name属性:`, player)
              return
            }
            debugLog(`[PlayerMode] ✓ 为玩家初始化playerState: "${player.name}"`)
            playerStates[player.name] = {
              _initialized: true,  // 哨兵值：防止Firebase剥离空对象
              currentBattleCities: [],
              battleGoldSkill: null,
              deadCities: [],
              usedSkills: [],
              activatedCitySkills: null  // 关键修复：用null代替{}
            }
            debugLog(`[PlayerMode] playerStates["${player.name}"]已创建:`, playerStates[player.name])
          })
          debugLog('[PlayerMode] 循环结束')
        }

        debugLog('[PlayerMode] playerStates构建完成，keys:', Object.keys(playerStates))
        debugLog('[PlayerMode] playerStates是否为空对象:', Object.keys(playerStates).length === 0)
        debugLog('[PlayerMode] playerStates内容:', JSON.stringify(playerStates, null, 2))

        // 关键修复：如果playerStates为空，使用null代替，避免被Firebase过滤
        // 后续在部署时再初始化具体的playerState
        const finalPlayerStates = Object.keys(playerStates).length > 0 ? playerStates : null
        if (finalPlayerStates === null) {
          console.warn('[PlayerMode] ⚠️ playerStates为空，使用null代替，将在部署时初始化')
        }

        // 如果roomData.gameState已存在但需要修复，保留currentRound
        const currentRound = roomData.gameState?.currentRound || 1

        roomData.gameState = {
          currentRound: currentRound,
          playerStates: finalPlayerStates,  // 使用非空对象或null
          battleProcessed: false,
          battleLock: null,
          knownCities: null,  // 用null代替{}，后续需要时再初始化
          ironCities: null,
          strengthBoost: null,
          morale: null,
          yqgzMarks: [],
          battleLogs: [],
          pendingSwaps: [],
          drawRequests: []
        }

        debugLog('[PlayerMode] gameState初始化完成')
        debugLog('[PlayerMode] playerStates keys:', finalPlayerStates ? Object.keys(finalPlayerStates) : 'null')
        debugLog('[PlayerMode] 完整gameState:', JSON.stringify(roomData.gameState, null, 2))
        debugLog('[PlayerMode] ======================================')
      }

      await saveRoomData(currentRoomId.value, roomData)
      debugLog('[PlayerMode] 已重置所有玩家的ready标志为false并初始化gameState')

      // 关键诊断：立即读取验证保存结果
      const verifyRoomData = await getRoomData(currentRoomId.value)
      if (verifyRoomData && verifyRoomData.gameState) {
        debugLog('[PlayerMode] ===== 验证保存后的gameState =====')
        debugLog('[PlayerMode] gameState存在:', !!verifyRoomData.gameState)
        debugLog('[PlayerMode] gameState keys:', Object.keys(verifyRoomData.gameState))
        debugLog('[PlayerMode] playerStates存在:', !!verifyRoomData.gameState.playerStates)
        debugLog('[PlayerMode] playerStates keys:', verifyRoomData.gameState.playerStates ? Object.keys(verifyRoomData.gameState.playerStates) : 'undefined')
        debugLog('[PlayerMode] playerStates内容:', JSON.stringify(verifyRoomData.gameState.playerStates, null, 2))
        debugLog('[PlayerMode] 完整gameState:', JSON.stringify(verifyRoomData.gameState, null, 2))
        debugLog('[PlayerMode] ======================================')
      } else {
        console.error('[PlayerMode] ❌ 验证失败：无法读取gameState')
      }

      // 进入中心城市选择界面
      currentStep.value = 'center-city-selection'
      debugLog('[PlayerMode] 进入中心城市选择界面')
    }
  }
}

/**
 * 玩家加入房间
 */
function handlePlayerJoined({ name, asSpectator }) {
  debugLog('[PlayerMode] 玩家加入房间', { name, asSpectator })
  if (!currentPlayer.value) {
    currentPlayer.value = { name }
  }
  // 在 PlayerModeOnline 层启动心跳，确保 WaitingRoom 卸载后心跳不中断
  if (currentRoomId.value && name) {
    startHeartbeat(currentRoomId.value, name)
    debugLog('[PlayerMode] 已在父组件启动心跳，防止步骤切换时心跳中断')
  }
  // Save session immediately when player joins
  if (!asSpectator && currentRoomId.value && name) {
    saveSession({
      roomId: currentRoomId.value,
      playerName: name,
      currentStep: currentStep.value,
      gameMode: gameMode.value,
      centerCityName: centerCityName.value
    })
  }
}

/**
 * Mid-game reconnection: WaitingRoom detected that the game is already active,
 * skip center-city-selection and go directly to city-deployment.
 */
async function handleMidGameReconnect({ name }) {
  debugLog('[PlayerMode] Mid-game reconnect for:', name)
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData) return

  roomData.players?.forEach(p => normalizePlayerCities(p))
  const playerData = roomData.players.find(p => p.name === name)
  if (!playerData) return

  normalizePlayerCities(playerData)
  currentPlayer.value = JSON.parse(JSON.stringify(playerData))
  gameMode.value = roomData.mode || '2P'
  centerCityName.value = playerData.centerCityName

  syncRoomDataToGameStore(roomData)
  startRoomDataListener()
  startHeartbeat(currentRoomId.value, name)
  currentStep.value = 'city-deployment'
}

/**
 * 选择中心城市
 */
async function handleCenterSelected(cityName) {
  debugLog('[PlayerMode] ===== 选择中心城市 (使用城市名称) =====')
  debugLog('[PlayerMode] 选择的城市名称:', cityName)

  // 保存到房间数据（使用partial update避免覆盖其他玩家数据）
  if (currentRoomId.value && currentPlayer.value) {
    try {
      const { getDatabase, ref: dbRef, update } = await import('firebase/database')
      const db = getDatabase()
      const roomData = await getRoomData(currentRoomId.value)
      if (roomData) {
        const playerIdx = roomData.players.findIndex(p => p.name === currentPlayer.value.name)
        if (playerIdx !== -1) {
          // 使用partial update只更新自己的centerCityName，避免覆盖其他玩家数据
          await update(dbRef(db), {
            [`rooms/${currentRoomId.value}/players/${playerIdx}/centerCityName`]: cityName
          })
          debugLog('[PlayerMode] 中心城市已通过partial update保存:', cityName)
        }
      }
    } catch (error) {
      console.error('[PlayerMode] 保存中心城市失败:', error)
    }
  }
  debugLog('[PlayerMode] ==========================================')
}

/**
 * 确认中心城市（2P/2v2）或确认抽取到的城市（3P）
 */
async function handleCenterConfirmed(cityName) {
  const is3P = gameMode.value === '3P'
  debugLog(`[PlayerMode] ===== 确认${is3P ? '抽取城市' : '中心城市'} =====`)
  debugLog('[PlayerMode] 确认的城市名称:', cityName)

  // 同步roomData到currentPlayer
  if (currentRoomId.value && currentPlayer.value) {
    const roomData = await getRoomData(currentRoomId.value)
    if (roomData) {
      // 规范化Firebase返回的cities数据
      roomData.players?.forEach(p => normalizePlayerCities(p))

      const playerIdx = roomData.players.findIndex(p => p.name === currentPlayer.value.name)
      if (playerIdx !== -1) {
        // 使用partial update只更新自己的字段，避免覆盖其他玩家数据
        try {
          const { getDatabase, ref: dbRef, update } = await import('firebase/database')
          const db = getDatabase()
          const updates = {}
          if (!is3P && cityName) {
            updates[`rooms/${currentRoomId.value}/players/${playerIdx}/centerCityName`] = cityName
            roomData.players[playerIdx].centerCityName = cityName
          }
          updates[`rooms/${currentRoomId.value}/players/${playerIdx}/ready`] = true
          roomData.players[playerIdx].ready = true
          await update(dbRef(db), updates)
          debugLog('[PlayerMode] 确认数据已通过partial update保存')
        } catch (error) {
          console.error('[PlayerMode] partial update失败，回退到全量保存:', error)
          if (!is3P && cityName) {
            roomData.players[playerIdx].centerCityName = cityName
          }
          roomData.players[playerIdx].ready = true
          await saveRoomData(currentRoomId.value, roomData)
        }
      }

      // 同步玩家数据到 gameStore
      syncRoomDataToGameStore(roomData)

      const updatedPlayerData = roomData.players.find(p => p.name === currentPlayer.value.name)
      if (updatedPlayerData) {
        currentPlayer.value = {
          ...updatedPlayerData,
          cities: currentPlayer.value.cities  // 保持原有cities数组引用
        }
      }

      // 检查是否所有玩家都准备好了
      const allPlayersReady = roomData.players.every(p => p.ready === true)
      debugLog('[PlayerMode] 所有玩家是否都已准备:', allPlayersReady)

      if (allPlayersReady) {
        debugLog('[PlayerMode] 所有玩家已确认，直接进入部署界面')
        currentStep.value = 'city-deployment'
        startRoomDataListener()
      } else {
        debugLog('[PlayerMode] 进入等待界面，等待其他玩家确认')
        currentStep.value = 'waiting-for-center-confirmation'
        startRoomDataListener()
      }
    }
  }
}

/**
 * 处理重新抽取城市
 */
async function handleRedrawCities() {
  debugLog('[PlayerMode] 重新抽取城市')

  if (playerDrawCount.value >= 5) {
    console.warn('[PlayerMode] 已达最大重抽次数')
    return
  }

  if (!currentRoomId.value || !currentPlayer.value) {
    console.error('[PlayerMode] 缺少房间或玩家信息')
    return
  }

  try {
    const roomData = await getRoomData(currentRoomId.value)
    if (!roomData) {
      console.error('[PlayerMode] 无法获取房间数据')
      return
    }

    const playerIdx = roomData.players.findIndex(p => p.name === currentPlayer.value.name)
    if (playerIdx === -1) {
      console.error('[PlayerMode] 未找到当前玩家')
      return
    }

    // 获取已被其他玩家使用的城市名称
    const excludeCities = getUsedNames(roomData.players, playerIdx)

    // 确定抽取数量
    const citiesPerPlayer = gameMode.value === '2v2' ? 7 : 10

    // 重新抽取城市
    const newCitiesArray = drawCities(citiesPerPlayer, excludeCities)

    // 关键修复：将数组转换为城市名称键的对象
    const newCities = {}
    newCitiesArray.forEach(city => {
      if (city && city.name) newCities[city.name] = city
    })

    // 更新玩家城市
    roomData.players[playerIdx].cities = newCities

    // 清空之前选择的中心城市和roster
    roomData.players[playerIdx].centerCityName = null
    roomData.players[playerIdx].roster = []

    // 保存到房间数据
    await saveRoomData(currentRoomId.value, roomData)

    // 关键修复：深度克隆避免引用共享，从roomData获取更新后的玩家对象
    const updatedPlayerData = JSON.parse(JSON.stringify(roomData.players[playerIdx]))
    debugLog('[PlayerMode] 重新抽取后更新currentPlayer（深度克隆）')
    debugLog('[PlayerMode] 新城市列表:', Object.values(updatedPlayerData.cities).map(c => c.name))
    currentPlayer.value = updatedPlayerData
    centerCityName.value = null
    // 注意：roster只在3P模式使用，2P模式不需要清空rosterCities

    // 增加抽取次数
    playerDrawCount.value++

    debugLog('[PlayerMode] 城市已重新抽取，共', Object.keys(updatedPlayerData.cities).length, '个城市')
  } catch (error) {
    console.error('[PlayerMode] 重新抽取城市失败:', error)
  }
}

/**
 * 游戏结束时停止所有后台活动（心跳、监听器）
 * 防止Firebase更新导致页面在结算画面中闪回战斗页面
 */
function stopAllOnGameOver() {
  debugLog('[PlayerMode] 游戏结束，停止心跳和监听器')
  stopHeartbeat()
  if (roomDataListener) {
    stopRoomListener()
    roomDataListener = null
  }
}

/**
 * 处理退出
 */
async function handleExit() {
  if (await showConfirm('确定要退出到主菜单吗？当前数据可能会丢失。', { title: '退出游戏', icon: '🚪' })) {
    // Clear saved session
    clearSession()

    // 停止监听
    if (roomDataListener) {
      stopRoomListener()
      roomDataListener = null
    }

    // 离开房间（清理资源）
    if (currentRoomId.value && currentPlayer.value) {
      await leaveRoom(currentRoomId.value, currentPlayer.value.name)
    }

    // 清空游戏状态（战斗日志、城市状态、技能状态等）
    gameStore.resetGame()

    emit('exit')
  }
}

/**
 * 处理认输
 */
async function handleSurrender() {
  if (!await showConfirm('确定要认输吗？对方将直接获胜！', { title: '认输确认', icon: '🏳️' })) return

  const myName = currentPlayer.value?.name
  if (!myName) return

  // 找到对手
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData || !roomData.players) return

  const opponent = roomData.players.find(p => p.name !== myName)
  if (!opponent) return

  // 设置游戏结束状态
  if (!roomData.gameState) roomData.gameState = {}
  roomData.gameState.gameOver = true
  roomData.gameState.winner = opponent.name

  await saveRoomData(currentRoomId.value, roomData)
  debugLog(`[认输] ${myName} 认输，${opponent.name} 获胜`)

  // 设置本地游戏结束状态
  const winnerPlayer = roomData.players.find(p => p.name === opponent.name)
  gameLogic.winner.value = winnerPlayer ? JSON.parse(JSON.stringify(winnerPlayer)) : null
  gameLogic.isGameOver.value = true
  showVictory.value = true
  stopAllOnGameOver()
}

/**
 * 处理求和请求
 */
async function handleRequestDraw() {
  const myName = currentPlayer.value?.name
  if (!myName) return

  // 找到对手
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData || !roomData.players) return

  const opponent = roomData.players.find(p => p.name !== myName)
  if (!opponent) return

  // 检查是否已有待处理的求和请求
  const existing = gameStore.drawRequests.filter(r =>
    r.status === 'pending' && r.initiatorName === myName
  )
  if (existing.length > 0) {
    await showAlert('你已经发送了求和请求，请等待对方回应。', { title: '提示', icon: '💡' })
    return
  }

  // 创建求和请求
  gameStore.createDrawRequest(myName, opponent.name)
  debugLog(`[求和] ${myName} 向 ${opponent.name} 发送求和请求`)

  // 同步到Firebase
  await syncDrawRequestsToFirebase()
  await showAlert('求和请求已发送，等待对方回应。', { title: '求和', icon: '🤝' })
}

/**
 * 处理接受和棋
 */
async function handleDrawAccepted({ request }) {
  gameStore.updateDrawRequestStatus(request.id, 'accepted')

  // 设置游戏结束 - 平局
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData) return

  if (!roomData.gameState) roomData.gameState = {}
  roomData.gameState.gameOver = true
  roomData.gameState.winner = '平局'
  roomData.gameState.drawRequests = gameStore.drawRequests

  await saveRoomData(currentRoomId.value, roomData)
  debugLog('[求和] 双方达成和棋')

  // 设置本地游戏结束状态
  gameLogic.winner.value = null
  gameLogic.isGameOver.value = true
  showVictory.value = true
  stopAllOnGameOver()
}

/**
 * 处理拒绝和棋
 */
async function handleDrawRejected({ request }) {
  gameStore.updateDrawRequestStatus(request.id, 'rejected')
  debugLog(`[求和] ${currentPlayer.value?.name} 拒绝了 ${request.initiatorName} 的求和请求`)

  // 同步到Firebase
  await syncDrawRequestsToFirebase()
}

/**
 * 同步drawRequests到Firebase
 */
async function syncDrawRequestsToFirebase() {
  try {
    await updateRoomGameState(currentRoomId.value, {
      drawRequests: gameStore.drawRequests
    })
    debugLog('[求和] drawRequests已同步到Firebase')
  } catch (error) {
    console.error('[求和] 同步drawRequests失败:', error)
  }
}

// 组件卸载时清理
onUnmounted(() => {
  if (roomDataListener) {
    stopRoomListener()
    roomDataListener = null
  }
  clearInterval(bxdcTimer.value)
})

/**
 * 处理技能使用
 */
function handleUseSkill(skill) {
  debugLog('[PlayerMode] 使用技能', skill)
  // TODO: 实现技能使用逻辑
}

/**
 * 处理回合结束
 * 参考 citycard_web.html lines 10455-10510
 */
async function handleEndTurn() {
  debugLog('[PlayerMode] 结束回合')

  if (!currentRoomId.value || !currentPlayer.value) {
    console.error('[PlayerMode] 缺少房间或玩家信息')
    return
  }

  // 获取最新房间数据
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData) {
    console.error('[PlayerMode] 无法获取房间数据')
    return
  }

  // 1. 执行所有回合结束状态更新
  // 这包括：屏障倒计时、保护罩倒计时、禁用倒计时、越战越勇、战力加成、
  // 移花接木、不露踪迹、定海神针、定时爆破、深藏不露、生于紫室、
  // 金币贷款、金融危机、寸步难行、抛砖引玉、血量存储利息、海市蜃楼、厚积薄发等
  gameStore.updateRoundStates()
  debugLog('[PlayerMode] 回合结束状态更新完成')

  // 2. 清空单回合效果（参考HTML lines 10493-10501）
  gameStore.qinwang = null
  gameStore.cmjb = null
  gameStore.ironwall = null
  gameStore.foresee = null
  gameStore.yujia = null

  // 清空反戈一击
  Object.keys(gameStore.reflect).forEach(key => delete gameStore.reflect[key])

  // 清空一举两得
  Object.keys(gameStore.forceDeployTwo).forEach(key => delete gameStore.forceDeployTwo[key])
  Object.keys(gameStore.cannotStandDown).forEach(key => delete gameStore.cannotStandDown[key])

  // 清空声东击西
  Object.keys(gameStore.sdxj).forEach(key => delete gameStore.sdxj[key])

  // 清空以逸待劳
  Object.keys(gameStore.yiyidl).forEach(key => delete gameStore.yiyidl[key])

  // 清空围魏救赵
  Object.keys(gameStore.wwjz).forEach(key => delete gameStore.wwjz[key])

  // 清空晕头转向
  Object.keys(gameStore.dizzy).forEach(key => delete gameStore.dizzy[key])

  // 清空草船借箭
  Object.keys(gameStore.ccjj).forEach(key => delete gameStore.ccjj[key])

  // 清空隔岸观火
  gameStore.gawhUser = null

  // 清空挑拨离间
  Object.keys(gameStore.tblj).forEach(key => delete gameStore.tblj[key])

  debugLog('[PlayerMode] 单回合效果已清空')

  // 3. 回合数+1（参考HTML line 10504）
  gameStore.currentRound++
  debugLog(`[PlayerMode] 进入第 ${gameStore.currentRound} 回合`)

  // 4. 同步更新后的状态到Firebase
  // 更新玩家数据
  roomData.players.forEach((player, idx) => {
    const gameStorePlayer = gameStore.players.find(p => p.name === player.name)
    if (gameStorePlayer) {
      // 同步城市HP和存活状态 - 保持对象结构
      player.cities = {}
      Object.entries(gameStorePlayer.cities).forEach(([cityName, city]) => {
        player.cities[cityName] = {
          ...city,
          currentHp: city.currentHp,
          isAlive: city.isAlive !== false
        }
      })
      // 同步金币
      player.gold = gameStorePlayer.gold

      // 关键修复Bug1: 同步streak数据
      if (gameStorePlayer.streaks) {
        player.streaks = { ...gameStorePlayer.streaks }
        debugLog(`[PlayerMode] handleEndTurn - 同步${player.name}的streaks到Firebase:`, player.streaks)
      }
    }
  })

  // 更新游戏状态
  if (!roomData.gameState) {
    roomData.gameState = {}
  }
  roomData.gameState.currentRound = gameStore.currentRound

  // 同步战斗相关状态到Firebase
  if (gameStore.purpleChamber && Object.keys(gameStore.purpleChamber).length > 0) {
    roomData.gameState.purpleChamber = JSON.parse(JSON.stringify(gameStore.purpleChamber))
  } else {
    roomData.gameState.purpleChamber = {}
  }

  // 关键修复：同步updateRoundStates()后的技能冷却到Firebase
  // 不同步会导致Firebase中的旧cooldown值覆盖本地已递减的值
  if (gameStore.cooldowns && Object.keys(gameStore.cooldowns).length > 0) {
    roomData.gameState.cooldowns = JSON.parse(JSON.stringify(gameStore.cooldowns))
  } else {
    roomData.gameState.cooldowns = null
  }

  // 同步日志到Firebase
  roomData.gameState.battleLogs = [...gameStore.logs]

  // 保存到Firebase
  await saveRoomData(currentRoomId.value, roomData)
  debugLog('[PlayerMode] 回合结束状态已同步到Firebase')

  // 5. 添加日志
  gameStore.addLog(`第 ${gameStore.currentRound} 回合开始`)
}

/**
 * 处理治疗城市
 */
function handleHealCity(city) {
  debugLog('[PlayerMode] 治疗城市', city)
  // TODO: 实现治疗逻辑
}

/**
 * 处理快速技能
 */
function handleQuickSkill(skill) {
  debugLog('[PlayerMode] 快速技能', skill)
  // TODO: 实现快速技能逻辑
}

/**
 * 处理技能选择
 * 参考 citycard_web.html 技能执行逻辑
 */
async function handleSkillSelected(skillData) {
  debugLog('[PlayerMode] 技能已选择', skillData)
  showSkillSelector.value = false

  // ===== 诊断：检查 gameStore 状态 =====
  debugLog('[PlayerMode] ===== gameStore 诊断 =====')
  debugLog('[PlayerMode] gameStore 是否存在:', !!gameStore)
  debugLog('[PlayerMode] gameStore.pendingSwaps 类型:', typeof gameStore.pendingSwaps)
  debugLog('[PlayerMode] gameStore.pendingSwaps 值:', gameStore.pendingSwaps)
  debugLog('[PlayerMode] gameStore.createPendingSwap 是否存在:', typeof gameStore.createPendingSwap)
  // 关键修复：Pinia自动解包ref，直接检查数组
  if (Array.isArray(gameStore.pendingSwaps)) {
    debugLog('[PlayerMode] gameStore.pendingSwaps 长度:', gameStore.pendingSwaps.length)
    debugLog('[PlayerMode] gameStore.pendingSwaps内容:', gameStore.pendingSwaps)
  }
  debugLog('[PlayerMode] ===========================')

  if (!skillData || !skillData.skillName) {
    console.error('[PlayerMode] 技能数据无效')
    return
  }

  if (!currentRoomId.value || !currentPlayer.value) {
    console.error('[PlayerMode] 缺少房间或玩家信息')
    return
  }

  // 如果技能已在SkillSelector中执行成功，直接同步数据到Firebase
  if (skillData.result && skillData.result.success) {
    debugLog('[PlayerMode] 技能已在SkillSelector中执行，直接同步数据到Firebase')

    // ===== 时来运转/人质交换弹窗检查 =====
    if (skillData.result.isPending && (skillData.skillName === '时来运转' || skillData.skillName === '人质交换')) {
      debugLog('[PlayerMode] 时来运转/人质交换需要弹窗确认，进入pendingFortuneSwap流程')

      const opponentName = skillData.targetPlayerName ||
        gameStore.players.find(p => p.name !== currentPlayer.value?.name)?.name
      const opponent = gameStore.players.find(p => p.name === opponentName)

      if (!opponent) {
        console.error('[PlayerMode] 找不到对手')
        return
      }

      // 判断是否需要弹窗：B能使用李代桃僵 OR 无懈可击中至少一个
      const canTargetUseLiDai = (() => {
        if (opponent.gold < 6) return false
        if (gameStore.bannedSkills?.[opponentName]?.['李代桃僵']) return false
        if (gameStore.cooldowns?.[opponentName]?.['李代桃僵'] > 0) return false
        const usageCount = gameStore.getSkillUsageCount(opponentName, '李代桃僵')
        if (usageCount >= 2) return false
        return true
      })()

      const canTargetUseWuXie = (() => {
        if (opponent.gold < 11) return false
        if (gameStore.bannedSkills?.[opponentName]?.['无懈可击']) return false
        if (gameStore.cooldowns?.[opponentName]?.['无懈可击'] > 0) return false
        return true
      })()

      if (!canTargetUseLiDai && !canTargetUseWuXie) {
        // B既不能用李代桃僵也不能用无懈可击 → 直接执行交换
        debugLog('[PlayerMode] 对手无法响应，直接执行交换')
        const nonBattleSkills = await import('../../composables/skills/nonBattleSkills.js')
        let result
        if (skillData.skillName === '时来运转') {
          result = nonBattleSkills.useNonBattleSkills().executeFortuneSwap(
            currentPlayer.value.name, opponentName,
            skillData.result.casterCities, skillData.result.targetCities
          )
        } else {
          result = nonBattleSkills.useNonBattleSkills().executeHostageSwap(
            currentPlayer.value.name, opponentName,
            skillData.result.casterCities[0], skillData.result.targetCities[0]
          )
        }
        debugLog('[PlayerMode] 直接执行交换结果:', result)
        // 关键修复：更新快照以包含交换后的状态
        // executeHostageSwap/executeFortuneSwap在gameStore.players上执行了交换
        // 但playersSnapshot是在isPending返回时（交换前）拍摄的，不包含交换结果
        // 必须重新拍摄快照，否则后续Firebase同步会用旧数据覆盖交换结果
        skillData.playersSnapshot = JSON.parse(JSON.stringify(gameStore.players))
        // 继续正常的Firebase同步（跳到下面的正常流程）
      } else {
        // 需要弹窗 → 创建 pendingFortuneSwap → 同步Firebase → 等待
        const swapData = gameStore.createPendingFortuneSwap({
          type: skillData.skillName,
          casterName: currentPlayer.value.name,
          targetName: opponentName,
          casterCities: skillData.result.casterCities,
          targetCities: skillData.result.targetCities
        })

        // 关键：从playersSnapshot获取扣除金币后的正确金币值
        const casterGoldAfterDeduct = (skillData.playersSnapshot || gameStore.players)
          .find(p => p.name === currentPlayer.value.name)?.gold

        // 更新本地currentPlayer金币（确保UI显示正确）
        if (casterGoldAfterDeduct !== undefined) {
          currentPlayer.value.gold = casterGoldAfterDeduct
        }

        // 同步到Firebase
        try {
          const { getDatabase, ref: dbRef, update } = await import('firebase/database')
          const db = getDatabase()

          const casterIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value.name)
          const plainSwapData = JSON.parse(JSON.stringify(swapData))
          debugLog('[PlayerMode] pendingFortuneSwap将写入Firebase:', plainSwapData)

          const updates = {
            [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: plainSwapData,
            [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
          }

          // 同步caster的金币扣除（使用快照中的正确值）
          if (casterIdx >= 0) {
            updates[`rooms/${currentRoomId.value}/players/${casterIdx}/gold`] = casterGoldAfterDeduct !== undefined ? casterGoldAfterDeduct : currentPlayer.value.gold
          }

          await update(dbRef(db), updates)
          debugLog('[PlayerMode] pendingFortuneSwap已同步到Firebase，等待对手响应')
        } catch (error) {
          console.error('[PlayerMode] 同步pendingFortuneSwap失败:', error)
        }

        // 启动等待
        waitingForFortuneSwap.value = true
        return // 不继续执行后续的同步逻辑
      }
    }
    // ===== END 时来运转/人质交换弹窗检查 =====

    // ===== 无懈可击拦截检查 =====
    // 确定对手名称
    const opponentName = skillData.targetPlayerName ||
      gameStore.players.find(p => p.name !== currentPlayer.value?.name)?.name

    if (opponentName && shouldIntercept(skillData.skillName, opponentName)) {
      debugLog('[PlayerMode] 技能需要拦截检查，进入pendingIntercept流程')

      // 关键修复：回滚SkillSelector本地执行产生的日志
      // SkillSelector在本地执行技能时会添加日志，但进入拦截流程后这些效果应被回滚
      // executePendingSkill会在对手接受后重新执行技能并产生正确的日志
      if (skillData.logsLengthBeforeExecution !== undefined && gameStore.logs.length > skillData.logsLengthBeforeExecution) {
        const removedCount = gameStore.logs.length - skillData.logsLengthBeforeExecution
        gameStore.logs.splice(skillData.logsLengthBeforeExecution)
        debugLog(`[PlayerMode] 已回滚拦截前的本地日志 ${removedCount} 条（从 ${skillData.logsLengthBeforeExecution + removedCount} → ${skillData.logsLengthBeforeExecution}）`)
      }

      // 同时回滚私密日志（避免拦截取消后仍显示第一次执行的私密日志）
      if (skillData.privateLogsLengthBeforeExecution !== undefined) {
        const playerName = currentPlayer.value?.name
        const privateLogs = gameStore.playerPrivateLogs?.[playerName]
        if (privateLogs && privateLogs.length > skillData.privateLogsLengthBeforeExecution) {
          const removedCount = privateLogs.length - skillData.privateLogsLengthBeforeExecution
          privateLogs.splice(skillData.privateLogsLengthBeforeExecution)
          debugLog(`[PlayerMode] 已回滚拦截前的私密日志 ${removedCount} 条`)
        }
      }

      // 计算技能实际花费和拦截费用
      const skillCost = getActualSkillCost(skillData.skillName, currentPlayer.value, gameStore) || SKILL_COSTS[skillData.skillName] || 0
      const interceptCost = getInterceptCost(skillCost)

      // 创建pendingIntercept（技能效果暂不生效，但金币已扣）
      const interceptData = gameStore.createPendingIntercept({
        casterName: currentPlayer.value.name,
        targetName: opponentName,
        skillName: skillData.skillName,
        skillData: {
          skillName: skillData.skillName,
          targetPlayerName: skillData.targetPlayerName,
          targetCityName: skillData.targetCityName,
          selfCityName: skillData.selfCityName,
          selectedSelfCities: skillData.selectedSelfCities,
          selectedTargetCities: skillData.selectedTargetCities,
          selectedSkillName: skillData.selectedSkillName,
          amount: skillData.amount,
          correctCount: skillData.correctCount
        },
        skillCost,
        interceptCost
      })

      // 关键修复：进入拦截流程时，不同步技能效果到Firebase
      // SkillSelector已在本地执行了技能（金币变化、日志等），但这些效果应在对手响应后再生效
      // Firebase目前还保存着技能执行前的状态（正确），executePendingSkill会在对手接受后重新执行技能
      // 因此这里只需写入pendingIntercept数据，不写入金币和日志
      // Firebase监听器会自动将本地状态回滚到Firebase的pre-execution状态

      try {
        const { getDatabase, ref: dbRef, update } = await import('firebase/database')
        const db = getDatabase()

        // 关键修复：将interceptData序列化为纯对象，避免Vue Proxy和undefined值导致Firebase存储异常
        const plainInterceptData = JSON.parse(JSON.stringify(interceptData))
        debugLog('[PlayerMode] pendingIntercept将写入Firebase:', plainInterceptData)

        const updates = {
          [`rooms/${currentRoomId.value}/gameState/pendingIntercept`]: plainInterceptData
        }

        await update(dbRef(db), updates)
        debugLog('[PlayerMode] pendingIntercept已同步到Firebase，等待对手响应（不同步金币/日志，由executePendingSkill处理）')
      } catch (error) {
        console.error('[PlayerMode] 同步pendingIntercept失败:', error)
      }

      // 启动等待计时器
      startInterceptWaitTimer()
      return // 不继续执行后续的同步逻辑
    }
    // ===== END 无懈可击拦截检查 =====

    // ===== 博学多才：拦截通过后（或无需拦截）进行答题 =====
    if (skillData.skillName === '博学多才' && skillData.result?.needsQuiz) {
      const correctCount = await startBxdcQuizAsync(skillData.selfCityName, currentPlayer.value.name)
      // 关键修复：答题期间Firebase监听器可能覆盖gameStore.players（恢复为扣金币前的状态）
      // 必须先从原始快照恢复gameStore.players（包含正确的金币扣除和技能使用记录），再执行答题效果
      if (skillData.playersSnapshot) {
        skillData.playersSnapshot.forEach((snapshotPlayer) => {
          const storeIdx = gameStore.players.findIndex(p => p.name === snapshotPlayer.name)
          if (storeIdx >= 0) {
            gameStore.players[storeIdx] = JSON.parse(JSON.stringify(snapshotPlayer))
          }
        })
        debugLog('[PlayerMode] 博学多才：已从快照恢复gameStore.players（防止Firebase监听器覆盖金币）')
      }
      // 同时恢复skillUsageTracking和cooldowns（可能也被Firebase监听器覆盖）
      // 注意：SkillSelector在执行技能后已通过recordSkillUsage和setSkillCooldown更新了这些状态
      // 但Firebase监听器可能在答题期间用旧数据覆盖，需要确保技能使用次数和冷却被正确保留
      if (skillData.skillUsageSnapshot) {
        Object.keys(gameStore.skillUsageTracking).forEach(k => delete gameStore.skillUsageTracking[k])
        Object.assign(gameStore.skillUsageTracking, JSON.parse(JSON.stringify(skillData.skillUsageSnapshot)))
      }
      if (skillData.cooldownsSnapshot) {
        Object.keys(gameStore.cooldowns).forEach(k => delete gameStore.cooldowns[k])
        Object.assign(gameStore.cooldowns, JSON.parse(JSON.stringify(skillData.cooldownsSnapshot)))
      }
      if (skillData.roundGoldSpentSnapshot) {
        Object.keys(gameStore.roundGoldSpent).forEach(k => delete gameStore.roundGoldSpent[k])
        Object.assign(gameStore.roundGoldSpent, JSON.parse(JSON.stringify(skillData.roundGoldSpentSnapshot)))
      }
      if (skillData.bannedSkillsSnapshot) {
        Object.keys(gameStore.bannedSkills).forEach(k => delete gameStore.bannedSkills[k])
        Object.assign(gameStore.bannedSkills, JSON.parse(JSON.stringify(skillData.bannedSkillsSnapshot)))
      }
      const nbsMod = await import('../../composables/skills/nonBattleSkills.js')
      const casterPlayer = gameStore.players.find(p => p.name === currentPlayer.value.name)
      nbsMod.useNonBattleSkills().executeBoXueDuoCai(casterPlayer, skillData.selfCityName, correctCount, { skipGold: true })
      // 重新生成快照，包含答题后的HP变化（此时gameStore.players已有正确的金币和HP）
      skillData.playersSnapshot = JSON.parse(JSON.stringify(gameStore.players))
    }

    // 关键修复：恢复skillUsageTracking/cooldowns/roundGoldSpent快照
    // 动画播放期间（~2秒）Firebase监听器可能用旧数据覆盖这些状态
    // 必须在同步到Firebase前从快照恢复，确保技能使用次数、冷却等不丢失
    if (skillData.skillUsageSnapshot) {
      Object.keys(gameStore.skillUsageTracking).forEach(k => delete gameStore.skillUsageTracking[k])
      Object.assign(gameStore.skillUsageTracking, JSON.parse(JSON.stringify(skillData.skillUsageSnapshot)))
    }
    if (skillData.cooldownsSnapshot) {
      Object.keys(gameStore.cooldowns).forEach(k => delete gameStore.cooldowns[k])
      Object.assign(gameStore.cooldowns, JSON.parse(JSON.stringify(skillData.cooldownsSnapshot)))
    }
    if (skillData.roundGoldSpentSnapshot) {
      Object.keys(gameStore.roundGoldSpent).forEach(k => delete gameStore.roundGoldSpent[k])
      Object.assign(gameStore.roundGoldSpent, JSON.parse(JSON.stringify(skillData.roundGoldSpentSnapshot)))
    }
    if (skillData.bannedSkillsSnapshot) {
      Object.keys(gameStore.bannedSkills).forEach(k => delete gameStore.bannedSkills[k])
      Object.assign(gameStore.bannedSkills, JSON.parse(JSON.stringify(skillData.bannedSkillsSnapshot)))
    }

    // 关键修复：使用SkillSelector保存的快照（技能执行后、动画前的状态）
    // 动画播放期间Firebase监听器可能用旧数据覆盖gameStore.players
    // 快照确保我们获取正确的技能执行后状态
    const playersSource = skillData.playersSnapshot || gameStore.players
    const updatedPlayer = playersSource.find(p => p.name === currentPlayer.value?.name)
    if (updatedPlayer) {
      currentPlayer.value = JSON.parse(JSON.stringify(updatedPlayer))
      debugLog('[PlayerMode] 已从快照同步 currentPlayer（金币/HP等）')
    }

    // 关键修复：同时恢复gameStore.players（可能被监听器覆盖了）
    if (skillData.playersSnapshot) {
      skillData.playersSnapshot.forEach((snapshotPlayer, idx) => {
        const storeIdx = gameStore.players.findIndex(p => p.name === snapshotPlayer.name)
        if (storeIdx >= 0) {
          gameStore.players[storeIdx] = JSON.parse(JSON.stringify(snapshotPlayer))
        }
      })
      debugLog('[PlayerMode] 已从快照恢复 gameStore.players')
    }

    // 关键修复：恢复gameStore.playerStates（动画期间监听器可能用旧数据覆盖，导致needsNewCenter等标记丢失）
    if (skillData.playerStatesSnapshot && Object.keys(skillData.playerStatesSnapshot).length > 0) {
      Object.keys(skillData.playerStatesSnapshot).forEach(playerName => {
        gameStore.playerStates[playerName] = JSON.parse(JSON.stringify(skillData.playerStatesSnapshot[playerName]))
      })
      debugLog('[PlayerMode] 已从快照恢复 gameStore.playerStates')
    }

    try {
      // 使用快照数据（而非可能已被监听器覆盖的gameStore.players）
      const { getDatabase, ref: dbRef, update } = await import('firebase/database')
      const db = getDatabase()

      const playerUpdates = {}
      playersSource.forEach((player, idx) => {
        // 更新城市HP和存活状态（保持name-keyed对象格式，避免Firebase转为数组）
        const citiesForFirebase = {}
        Object.entries(player.cities).forEach(([cityName, city]) => {
          citiesForFirebase[cityName] = {
            ...city,
            currentHp: city.currentHp,
            isAlive: city.isAlive !== false
          }
        })
        playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/cities`] = citiesForFirebase
        // 更新金币
        playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/gold`] = player.gold
        // 更新中心城市（点石成金等技能可能更改）
        if (player.centerCityName !== undefined) {
          playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/centerCityName`] = player.centerCityName
        }
      })

      debugLog('[PlayerMode] 准备更新玩家数据:', Object.keys(playerUpdates))

      // 关键修复：正确读取pendingSwaps (Pinia会自动解包ref)
      // 先检查是否已解包成数组,再检查是否是未解包的ref
      let pendingSwapsUpdate = []
      if (Array.isArray(gameStore.pendingSwaps)) {
        // Pinia自动解包,gameStore.pendingSwaps直接是数组
        pendingSwapsUpdate = gameStore.pendingSwaps
        debugLog('[PlayerMode] pendingSwaps已被Pinia解包,直接使用数组')
      } else if (gameStore.pendingSwaps?.value && Array.isArray(gameStore.pendingSwaps.value)) {
        // 未解包的ref,需要访问.value
        pendingSwapsUpdate = gameStore.pendingSwaps.value
        debugLog('[PlayerMode] pendingSwaps是未解包的ref,使用.value')
      } else {
        // 其他情况,使用空数组
        pendingSwapsUpdate = []
        console.warn('[PlayerMode] pendingSwaps既不是数组也不是ref,使用空数组')
      }

      debugLog('[PlayerMode] 技能执行后 gameStore.pendingSwaps:', gameStore.pendingSwaps)
      debugLog('[PlayerMode] 技能执行后 pendingSwaps类型:', Array.isArray(gameStore.pendingSwaps) ? 'Array' : typeof gameStore.pendingSwaps)
      debugLog('[PlayerMode] 同步pendingSwaps到Firebase:', pendingSwapsUpdate.length, '条请求', pendingSwapsUpdate)

      // 关键修复：一次性更新所有数据（玩家数据 + pendingSwaps + logs），避免触发多次监听器
      // 将pendingSwaps也加入到playerUpdates中，一起更新
      playerUpdates[`rooms/${currentRoomId.value}/gameState/pendingSwaps`] = pendingSwapsUpdate

      // 关键修复：同步日志到Firebase，确保所有玩家都能看到技能使用日志
      playerUpdates[`rooms/${currentRoomId.value}/gameState/battleLogs`] = [...gameStore.logs]

      // 同步禁用技能状态到Firebase（事半功倍/解除封锁）
      // 必须始终同步：解除封锁后需要写入空对象以清除Firebase中的旧禁用状态
      playerUpdates[`rooms/${currentRoomId.value}/gameState/bannedSkills`] = gameStore.bannedSkills && Object.keys(gameStore.bannedSkills).length > 0
        ? JSON.parse(JSON.stringify(gameStore.bannedSkills))
        : {}

      // 同步技能保护状态到Firebase
      if (gameStore.skillProtection && Object.keys(gameStore.skillProtection).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/skillProtection`] = JSON.parse(JSON.stringify(gameStore.skillProtection))
      }

      // 同步已知城市到Firebase（劫富济贫等技能会调用setCityKnown）
      if (gameStore.knownCities && Object.keys(gameStore.knownCities).length > 0) {
        const knownCitiesForFirebase = {}
        Object.keys(gameStore.knownCities).forEach(observer => {
          knownCitiesForFirebase[observer] = {}
          Object.keys(gameStore.knownCities[observer]).forEach(owner => {
            const cities = gameStore.knownCities[observer][owner]
            knownCitiesForFirebase[observer][owner] = cities instanceof Set ? Array.from(cities) : (Array.isArray(cities) ? cities : [])
          })
        })
        playerUpdates[`rooms/${currentRoomId.value}/gameState/knownCities`] = knownCitiesForFirebase
      }

      // 同步代行省权状态到Firebase
      if (gameStore.actingCapital && Object.keys(gameStore.actingCapital).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/actingCapital`] = JSON.parse(JSON.stringify(gameStore.actingCapital))
      }

      // 同步守望相助状态到Firebase
      if (gameStore.mutualWatch && Object.keys(gameStore.mutualWatch).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/mutualWatch`] = JSON.parse(JSON.stringify(gameStore.mutualWatch))
      }

      // 同步生于紫室状态到Firebase
      if (gameStore.purpleChamber && Object.keys(gameStore.purpleChamber).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/purpleChamber`] = JSON.parse(JSON.stringify(gameStore.purpleChamber))
      }

      // 同步副中心制状态到Firebase
      if (gameStore.subCenters && Object.keys(gameStore.subCenters).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/subCenters`] = JSON.parse(JSON.stringify(gameStore.subCenters))
      }

      // 同步天灾人祸状态到Firebase
      if (gameStore.disaster && Object.keys(gameStore.disaster).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/disaster`] = JSON.parse(JSON.stringify(gameStore.disaster))
      }

      // 同步厚积薄发状态到Firebase
      if (gameStore.hjbf && Object.keys(gameStore.hjbf).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/hjbf`] = JSON.parse(JSON.stringify(gameStore.hjbf))
      }

      // 同步定海神针状态到Firebase
      if (gameStore.anchored && Object.keys(gameStore.anchored).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/anchored`] = JSON.parse(JSON.stringify(gameStore.anchored))
      }

      // 同步电磁感应状态到Firebase
      if (gameStore.electromagnetic && Object.keys(gameStore.electromagnetic).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/electromagnetic`] = JSON.parse(JSON.stringify(gameStore.electromagnetic))
      }

      // 同步屏障状态到Firebase
      if (gameStore.barrier && Object.keys(gameStore.barrier).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/barrier`] = JSON.parse(JSON.stringify(gameStore.barrier))
      }

      // 同步bannedCities状态到Firebase（高级治疗等禁用城市）
      if (gameStore.bannedCities && Object.keys(gameStore.bannedCities).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/bannedCities`] = JSON.parse(JSON.stringify(gameStore.bannedCities))
      }

      // 同步playerStates到Firebase（强制转移等技能会设置needsNewCenter标记）
      // 关键修复：优先使用快照，因为动画播放期间Firebase监听器可能用旧数据覆盖gameStore.playerStates
      const playerStatesSource = skillData.playerStatesSnapshot || gameStore.playerStates
      if (playerStatesSource && Object.keys(playerStatesSource).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/playerStates`] = JSON.parse(JSON.stringify(playerStatesSource))
      }

      // 同步技能冷却状态到Firebase（始终同步，冷却清除时需写入空对象覆盖旧值）
      playerUpdates[`rooms/${currentRoomId.value}/gameState/cooldowns`] = gameStore.cooldowns && Object.keys(gameStore.cooldowns).length > 0
        ? JSON.parse(JSON.stringify(gameStore.cooldowns))
        : {}

      // 同步金币贷款状态到Firebase
      if (gameStore.goldLoanRounds && Object.keys(gameStore.goldLoanRounds).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/goldLoanRounds`] = JSON.parse(JSON.stringify(gameStore.goldLoanRounds))
      }

      // 同步钢铁城市状态到Firebase
      if (gameStore.ironCities && Object.keys(gameStore.ironCities).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/ironCities`] = JSON.parse(JSON.stringify(gameStore.ironCities))
      }

      // 同步坚不可摧状态到Firebase
      if (gameStore.jianbukecui && Object.keys(gameStore.jianbukecui).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/jianbukecui`] = JSON.parse(JSON.stringify(gameStore.jianbukecui))
      }

      // 同步城市保护状态到Firebase
      if (gameStore.protections && Object.keys(gameStore.protections).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/protections`] = JSON.parse(JSON.stringify(gameStore.protections))
      }

      // 同步拔旗易帜标记到Firebase
      if (gameStore.changeFlagMark && Object.keys(gameStore.changeFlagMark).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/changeFlagMark`] = JSON.parse(JSON.stringify(gameStore.changeFlagMark))
      }

      // 同步技能使用次数到Firebase
      if (gameStore.skillUsageTracking && Object.keys(gameStore.skillUsageTracking).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/skillUsageTracking`] = JSON.parse(JSON.stringify(gameStore.skillUsageTracking))
      }

      // 同步单回合技能花费到Firebase
      if (gameStore.roundGoldSpent && Object.keys(gameStore.roundGoldSpent).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/roundGoldSpent`] = JSON.parse(JSON.stringify(gameStore.roundGoldSpent))
      }

      // 同步伪装城市状态到Firebase
      if (gameStore.disguisedCities && Object.keys(gameStore.disguisedCities).length > 0) {
        playerUpdates[`rooms/${currentRoomId.value}/gameState/disguisedCities`] = JSON.parse(JSON.stringify(gameStore.disguisedCities))
      }

      // 同步谨慎交换集合到Firebase（步步高升）
      if (gameStore.cautiousExchange && Object.keys(gameStore.cautiousExchange).length > 0) {
        const ceForFirebase = {}
        Object.keys(gameStore.cautiousExchange).forEach(playerName => {
          const set = gameStore.cautiousExchange[playerName]
          ceForFirebase[playerName] = set instanceof Set ? Array.from(set) : (Array.isArray(set) ? set : [])
        })
        playerUpdates[`rooms/${currentRoomId.value}/gameState/cautiousExchange`] = ceForFirebase
      }

      // 同步谨慎交换集合到Firebase（技能效果）
      if (gameStore.cautionSet && Object.keys(gameStore.cautionSet).length > 0) {
        const csForFirebase = {}
        Object.keys(gameStore.cautionSet).forEach(playerName => {
          const set = gameStore.cautionSet[playerName]
          csForFirebase[playerName] = set instanceof Set ? Array.from(set) : (Array.isArray(set) ? set : [])
        })
        playerUpdates[`rooms/${currentRoomId.value}/gameState/cautionSet`] = csForFirebase
      }

      debugLog('[PlayerMode] 准备一次性更新到Firebase:', Object.keys(playerUpdates).length, '个字段')

      await update(dbRef(db), playerUpdates)
      debugLog('[PlayerMode] 所有数据已一次性同步到Firebase（玩家数据 + pendingSwaps + logs）')

      // 战斗技能的公开日志在battle2P中输出，此处不公开（避免提前暴露策略）
      // isPending的技能（时来运转/人质交换）不输出"等待对手响应"日志，实际交换日志由executeFortuneSwap/executeHostageSwap内部添加
      if (!skillData.result.hidePublicLog && !skillData.result.isPending) {
        gameStore.addLog(skillData.result.message || `${skillData.skillName} 执行成功`)
      }

      // ===== 非战斗技能后检查游戏是否结束（如无知无畏击杀中心城市） =====
      // 先检查生于紫室继承（必须在checkWinCondition之前）
      const playersForCheck = skillData.playersSnapshot || gameStore.players
      playersForCheck.forEach(player => {
        gameStore.checkCenterDeathAndPurpleChamberInheritance(player)
      })

      // 检查胜负条件
      const gameOverResult = gameLogic.checkWinCondition(playersForCheck, gameStore)
      if (gameLogic.isGameOver.value) {
        debugLog('[PlayerMode] 非战斗技能导致游戏结束！')

        // 如果生于紫室继承改变了centerCityName，同步到Firebase
        const centerUpdates = {}
        playersForCheck.forEach((player, idx) => {
          centerUpdates[`rooms/${currentRoomId.value}/players/${idx}/centerCityName`] = player.centerCityName
          // 同步城市的isCenter标记和isAlive状态
          const citiesUpdate = {}
          Object.entries(player.cities).forEach(([cityName, city]) => {
            citiesUpdate[cityName] = {
              ...city,
              currentHp: city.currentHp,
              isAlive: city.isAlive !== false,
              isCenter: city.isCenter || false
            }
          })
          centerUpdates[`rooms/${currentRoomId.value}/players/${idx}/cities`] = citiesUpdate
        })
        // 设置游戏结束状态
        centerUpdates[`rooms/${currentRoomId.value}/gameState/gameOver`] = true
        centerUpdates[`rooms/${currentRoomId.value}/gameState/winner`] = gameLogic.winner.value?.name || '平局'
        // 同步生于紫室状态（可能已被继承机制修改）
        centerUpdates[`rooms/${currentRoomId.value}/gameState/purpleChamber`] = JSON.parse(JSON.stringify(gameStore.purpleChamber || {}))

        await update(dbRef(db), centerUpdates)
        debugLog('[PlayerMode] 游戏结束状态已同步到Firebase')

        showVictory.value = true
        stopAllOnGameOver()
        return
      }
    } catch (error) {
      console.error('[PlayerMode] 同步数据到Firebase失败:', error)
      gameStore.addLog(`同步数据异常: ${error.message}`)
    }

    return
  }

  // 下面是原来的代码，用于处理SkillSelector中未执行的技能（理论上不应该走到这里）
  console.warn('[PlayerMode] 技能在SkillSelector中未执行，开始在此处执行（不推荐）')

  // 获取最新房间数据
  const roomData = await getRoomData(currentRoomId.value)
  if (!roomData) {
    console.error('[PlayerMode] 无法获取房间数据')
    return
  }

  // 找到当前玩家在gameStore中的对象
  const caster = gameStore.players.find(p => p.name === currentPlayer.value.name)
  if (!caster) {
    console.error('[PlayerMode] 未找到当前玩家')
    return
  }

  // 准备技能参数
  const { skillName, targetPlayerName, targetCityName, selfCityName, selectedSelfCities, amount } = skillData

  // 找到目标玩家（如果需要）
  let target = null
  if (targetPlayerName) {
    target = gameStore.players.find(p => p.name === targetPlayerName)
    if (!target) {
      console.error('[PlayerMode] 未找到目标玩家')
      return
    }
  }

  // 找到目标城市（如果需要）
  let targetCity = null
  if (target && targetCityName !== undefined && targetCityName !== null) {
    targetCity = target.cities[targetCityName]
  }

  // 找到自己的城市（如果需要）
  let selfCity = null
  if (selfCityName !== undefined && selfCityName !== null) {
    selfCity = caster.cities[selfCityName]
  }

  // 动态导入技能模块
  const battleSkills = await import('../../composables/skills/battleSkills.js')
  const nonBattleSkills = await import('../../composables/skills/nonBattleSkills.js')

  // 根据技能名称调用对应的执行函数
  let result = null
  try {
    // 战斗金币技能映射
    const battleSkillMap = {
      '擒贼擒王': () => battleSkills.useBattleSkills().executeQinZeiQinWang(caster, target),
      '草木皆兵': () => battleSkills.useBattleSkills().executeCaoMuJieBing(caster, target),
      '越战越勇': () => battleSkills.useBattleSkills().executeYueZhanYueYong(caster, selfCity),
      '吸引攻击': () => battleSkills.useBattleSkills().executeXiYinGongJi(caster, selfCity),
      '铜墙铁壁': () => battleSkills.useBattleSkills().executeTongQiangTieBi(caster, target),
      '背水一战': () => battleSkills.useBattleSkills().executeBeiShuiYiZhan(caster, selfCity),
      '料事如神': () => battleSkills.useBattleSkills().executeLiaoShiRuShen(caster, target, targetCity),
      '同归于尽': () => battleSkills.useBattleSkills().executeTongGuiYuJin(caster, selfCity),
      '设置屏障': () => battleSkills.useBattleSkills().executeSetBarrier(caster),
      '潜能激发': () => battleSkills.useBattleSkills().executeQianNengJiFa(caster),
      '御驾亲征': () => battleSkills.useBattleSkills().executeYuJiaQinZheng(caster, target),
      '狂暴模式': () => battleSkills.useBattleSkills().executeKuangBaoMoShi(caster, selfCity),
      '按兵不动': () => battleSkills.useBattleSkills().executeAnBingBuDong(caster),
      '既来则安': () => battleSkills.useBattleSkills().executeJiLaiZeAn(caster, selfCity),
      '反戈一击': () => battleSkills.useBattleSkills().executeFanGeYiJi(caster, target),
      '暗度陈仓': () => battleSkills.useBattleSkills().executeAnDuChenCang(caster),
      '声东击西': () => battleSkills.useBattleSkills().executeShengDongJiXi(caster, target),
      '以逸待劳': () => battleSkills.useBattleSkills().executeYiYiDaiLao(caster, target),
      '草船借箭': () => battleSkills.useBattleSkills().executeCaoChuanJieJian(caster, target),
      '围魏救赵': () => battleSkills.useBattleSkills().executeWeiWeiJiuZhao(caster, target),
      '欲擒故纵': () => battleSkills.useBattleSkills().executeYuQinGuZong(caster, target, targetCity),
      '晕头转向': () => battleSkills.useBattleSkills().executeYunTouZhuanXiang(caster, target),
      '隔岸观火': () => battleSkills.useBattleSkills().executeGeAnGuanHuo(caster, target),
      '挑拨离间': () => battleSkills.useBattleSkills().executeTiaoBoBaoLiJian(caster, target),
      '趁火打劫': () => battleSkills.useBattleSkills().executeChenHuoDaJie(caster, target),
      '玉碎瓦全': () => battleSkills.useBattleSkills().executeYuSuiWaQuan(caster, target, targetCityName),
      '合纵连横': () => battleSkills.useBattleSkills().executeHeZongLianHeng(caster, target),
      '寸步难行': () => battleSkills.useBattleSkills().executeMuBuZhuanJing(caster, target),
      '抛砖引玉': () => battleSkills.useBattleSkills().executePaoZhuanYinYu(caster)
    }

    // 非战斗金币技能映射（完整版 - 按功能分类）
    const nonBattleSkillMap = {
      // ========== 1. 资源管理类 (7个) ==========
      '转账给他人': () => nonBattleSkills.useNonBattleSkills().executeTransferGold(caster, target, amount),
      '金币贷款': () => nonBattleSkills.useNonBattleSkills().executeJinBiDaiKuan(caster),
      '金融危机': () => nonBattleSkills.useNonBattleSkills().executeJinRongWeiJi(caster),
      '釜底抽薪': () => nonBattleSkills.useNonBattleSkills().executeFuDiChouXin(caster, target),
      '趁火打劫': () => nonBattleSkills.useNonBattleSkills().executeChenHuoDaJie(caster, target),
      '计划单列': () => nonBattleSkills.useNonBattleSkills().executeJiHuaDanLie(caster, selfCityName),
      '无中生有': () => nonBattleSkills.useNonBattleSkills().executeWuZhongShengYou(caster),
      '劫富济贫': () => nonBattleSkills.useNonBattleSkills().executeJieFuJiPin(caster, target),

      // ========== 2. 治疗/HP增强类 (10个) ==========
      '快速治疗': () => nonBattleSkills.useNonBattleSkills().executeKuaiSuZhiLiao(caster, caster.cities?.[selfCityName]),
      '高级治疗': () => nonBattleSkills.useNonBattleSkills().executeGaoJiZhiLiao(caster, selectedSelfCities || [selfCityName]),
      '借尸还魂': () => nonBattleSkills.useNonBattleSkills().executeJieShiHuanHun(caster, caster.cities?.[selfCityName]),
      '实力增强': () => nonBattleSkills.useNonBattleSkills().executeShiLiZengQiang(caster, selfCity),
      '士气大振': () => nonBattleSkills.useNonBattleSkills().executeShiQiDaZhen(caster),
      '苟延残喘': () => nonBattleSkills.useNonBattleSkills().executeGouYanCanChuan(caster),
      '众志成城': () => nonBattleSkills.useNonBattleSkills().executeZhongZhiChengCheng(caster, selectedSelfCities),
      '焕然一新': () => nonBattleSkills.useNonBattleSkills().executeHuanRanYiXin(caster, caster.cities?.[selfCityName]),
      '厚积薄发': () => nonBattleSkills.useNonBattleSkills().executeHouJiBaoFa(caster, caster.cities?.[selfCityName]),
      '血量存储': () => nonBattleSkills.useNonBattleSkills().executeXueLiangCunChu(caster, selfCity),

      // ========== 3. 保护/防御类 (12个) ==========
      '城市保护': () => nonBattleSkills.useNonBattleSkills().executeCityProtection(caster, selfCity),
      '钢铁城市': () => nonBattleSkills.useNonBattleSkills().executeGangTieChengShi(caster, caster.cities?.[selfCityName]),
      '定海神针': () => nonBattleSkills.useNonBattleSkills().executeDingHaiShenZhen(caster, caster.cities?.[selfCityName]),
      '坚不可摧': () => nonBattleSkills.useNonBattleSkills().executeJianBuKeCui(caster),
      '步步高升': () => nonBattleSkills.useNonBattleSkills().executeBuBuGaoSheng(caster, caster.cities?.[selfCityName]),
      '海市蜃楼': () => nonBattleSkills.useNonBattleSkills().executeHaiShiShenLou(caster),
      '副中心制': () => nonBattleSkills.useNonBattleSkills().executeFuZhongXinZhi(caster, caster.cities?.[selfCityName]),
      '生于紫室': () => nonBattleSkills.useNonBattleSkills().executeShengYuZiShi(caster, caster.cities?.[selfCityName]),
      '深藏不露': () => nonBattleSkills.useNonBattleSkills().executeShenCangBuLu(caster, selfCity),
      '技能保护': () => nonBattleSkills.useNonBattleSkills().executeJiNengBaoHu(caster),

      // ========== 4. 攻击/伤害类 (18个) ==========
      '无知无畏': () => nonBattleSkills.useNonBattleSkills().executeWuZhiWuWei(caster, target),
      '一落千丈': () => nonBattleSkills.useNonBattleSkills().executeYiLuoQianZhang(caster, target, targetCity),
      '连续打击': () => nonBattleSkills.useNonBattleSkills().executeLianXuDaJi(caster, target, skillData.selectedTargetCities),
      '波涛汹涌': () => nonBattleSkills.useNonBattleSkills().executeBoTaoXiongYong(caster, target),
      '狂轰滥炸': () => nonBattleSkills.useNonBattleSkills().executeKuangHongLanZha(caster, target),
      '横扫一空': () => nonBattleSkills.useNonBattleSkills().executeHengSaoYiKong(caster, target),
      '万箭齐发': () => nonBattleSkills.useNonBattleSkills().executeWanJianQiFa(caster, target, targetCity),
      '降维打击': () => nonBattleSkills.useNonBattleSkills().executeJiangWeiDaJi(caster, target, targetCity),
      '定时爆破': () => nonBattleSkills.useNonBattleSkills().executeDingShiBaoPo(caster, target, targetCity),
      '灰飞烟灭': () => nonBattleSkills.useNonBattleSkills().executeYongJiuCuiHui(caster, target, targetCity),
      '连锁反应': () => nonBattleSkills.useNonBattleSkills().executeLianSuoFanYing(caster, target, targetCity),
      '进制扭曲': () => nonBattleSkills.useNonBattleSkills().executeJinZhiNiuQu(caster, target, targetCity),

      '天灾人祸': () => nonBattleSkills.useNonBattleSkills().executeTianZaiRenHuo(caster, target, targetCity),
      '自相残杀': () => nonBattleSkills.useNonBattleSkills().executeZiXiangCanSha(caster, target),
      '中庸之道': () => nonBattleSkills.useNonBattleSkills().executeZhongYongZhiDao(caster, target),

      '招贤纳士': () => nonBattleSkills.useNonBattleSkills().executeZhaoXianNaShi(caster, target),
      '清除加成': () => nonBattleSkills.useNonBattleSkills().executeQingChuJiaCheng(caster, target),

      // ========== 5. 控制/交换类 (15个) ==========
      '先声夺人': () => nonBattleSkills.useNonBattleSkills().executeXianShengDuoRen(caster, target, { casterCityName: selfCityName }),
      '时来运转': () => nonBattleSkills.useNonBattleSkills().executeShiLaiYunZhuan(caster, target),
      '人质交换': () => nonBattleSkills.useNonBattleSkills().executeRenZhiJiaoHuan(caster, target, selfCityName, targetCityName),
      '改弦更张': () => nonBattleSkills.useNonBattleSkills().executeGaiXianGengZhang(caster),
      '拔旗易帜': () => nonBattleSkills.useNonBattleSkills().executeBaQiYiZhi(caster, target, { myCityName: selfCityName, oppCityName: targetCityName }),
      '避而不见': () => nonBattleSkills.useNonBattleSkills().executeBiErBuJian(caster, target, targetCity),
      '狐假虎威': () => nonBattleSkills.useNonBattleSkills().executeHuJiaHuWei(caster, selfCity),
      '李代桃僵': () => nonBattleSkills.useNonBattleSkills().executeLiDaiTaoJiang(caster, selfCityName, targetCityName),
      '点石成金': () => nonBattleSkills.useNonBattleSkills().executeHaoGaoWuYuan(caster, selfCity),
      '数位反转': () => nonBattleSkills.useNonBattleSkills().executeShuWeiFanZhuan(caster, target, targetCity),
      '战略转移': () => nonBattleSkills.useNonBattleSkills().executeZhanLueZhuanYi(caster, selfCity),
      '倒反天罡': () => nonBattleSkills.useNonBattleSkills().executeDaoFanTianGang(caster, target, targetCityName),
      '移花接木': () => nonBattleSkills.useNonBattleSkills().executeYiHuaJieMu(caster, target),

      // ========== 6. 情报/侦查类 (6个) ==========
      '城市侦探': () => nonBattleSkills.useNonBattleSkills().executeCityDetective(caster, target, targetCityName),
      '城市预言': () => nonBattleSkills.useNonBattleSkills().executeCityProphecy(caster, target),
      '明察秋毫': () => nonBattleSkills.useNonBattleSkills().executeMingChaQiuHao(caster, target),
      '一举两得': () => nonBattleSkills.useNonBattleSkills().executeYiJuLiangDe(caster, target),
      '不露踪迹': () => nonBattleSkills.useNonBattleSkills().executeBuLuZongJi(caster, selfCityName),
      '博学多才': () => nonBattleSkills.useNonBattleSkills().executeBoXueDuoCai(caster, selfCityName, skillData.correctCount),

      // ========== 7. 省份相关类 (11个) ==========
      '四面楚歌': () => nonBattleSkills.useNonBattleSkills().executeSiMianChuGe(caster, target),
      '搬运救兵': () => nonBattleSkills.useNonBattleSkills().executeBanyunJiubingPutong(caster, selfCity),
      '大义灭亲': () => nonBattleSkills.useNonBattleSkills().executeDaYiMieQin(caster, selfCity),
      '强制搬运': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiBanYun(caster, target, targetCity),
      '代行省权': () => nonBattleSkills.useNonBattleSkills().executeDaiXingShengQuan(caster, selfCity),
      '守望相助': () => nonBattleSkills.useNonBattleSkills().executeShouWangXiangZhu(caster, caster.cities?.[selfCityName]),
      '行政中心': () => nonBattleSkills.useNonBattleSkills().executeXingZhengZhongXin(caster, selfCityName),
      '以礼来降': () => nonBattleSkills.useNonBattleSkills().executeYiLiLaiJiang(caster, target, targetCityName),
      '趁其不备': () => nonBattleSkills.useNonBattleSkills().executeChenqibubeiSuiji(caster, target),

      // ========== 8. 特殊机制类 (14个) ==========
      // 无懈可击已重构为实时拦截系统（不再是主动释放技能）
      '事半功倍': () => nonBattleSkills.useNonBattleSkills().executeShiBanGongBei(caster, skillData.selectedSkillName || selfCityName),
      '过河拆桥': () => nonBattleSkills.useNonBattleSkills().executeGuoHeChaiQiao(caster),
      '解除封锁': () => nonBattleSkills.useNonBattleSkills().executeJieChuFengSuo(caster, skillData.selectedSkillName || selfCityName),
      '一触即发': () => nonBattleSkills.useNonBattleSkills().executeYiChuJiFa(caster, skillData.selectedSkillName || targetCityName),
      '突破瓶颈': () => nonBattleSkills.useNonBattleSkills().executeTuPoPingJing(caster, skillData.selectedSkillName || selfCityName),
      '当机立断': () => nonBattleSkills.useNonBattleSkills().executeDangJiLiDuan(caster, target),
      '强制转移·普通': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiQianDuPutong(caster, target),
      '强制转移·高级': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiQianDuGaoji(caster, target, targetCity),
      '言听计从': () => nonBattleSkills.useNonBattleSkills().executeYanTingJiCong(caster, target, targetCityName),
      '电磁感应': () => nonBattleSkills.useNonBattleSkills().executeDianCiGanYing(caster, target),
      '城市试炼': () => nonBattleSkills.useNonBattleSkills().executeChengShiShiLian(caster, selfCity),
      '抛砖引玉': () => nonBattleSkills.useNonBattleSkills().executePaoZhuanYinYu(caster)
    }

    // 博学多才：fallback路径也需要答题
    if (skillName === '博学多才' && !skillData.correctCount) {
      const quizCount = await startBxdcQuizAsync(selfCityName, caster.name)
      skillData.correctCount = quizCount
    }

    // 查找并执行技能
    if (battleSkillMap[skillName]) {
      result = battleSkillMap[skillName]()
    } else if (nonBattleSkillMap[skillName]) {
      result = nonBattleSkillMap[skillName]()
    } else {
      console.warn('[PlayerMode] 未找到技能实现:', skillName)
      gameStore.addLog(`技能 ${skillName} 尚未实现`)
      return
    }

    // 检查技能执行结果
    if (result && result.success) {
      // 不再额外添加result.message日志：技能函数内部已通过addSkillUsageLog添加了完整日志
      debugLog('[PlayerMode] 技能执行成功:', result)

      // 同步更新后的状态到Firebase
      // 使用Firebase update方法，只更新变化的字段，不覆盖整个房间数据
      const playerUpdates = {}
      roomData.players.forEach((player, idx) => {
        const gameStorePlayer = gameStore.players.find(p => p.name === player.name)
        if (gameStorePlayer) {
          // 更新城市HP和存活状态（保持name-keyed对象格式）
          const citiesForFirebase = {}
          Object.entries(gameStorePlayer.cities).forEach(([cityName, city]) => {
            citiesForFirebase[cityName] = {
              ...city,
              currentHp: city.currentHp,
              isAlive: city.isAlive !== false
            }
          })
          playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/cities`] = citiesForFirebase
          // 更新金币
          playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/gold`] = gameStorePlayer.gold
        }
      })

      debugLog('[PlayerMode] 准备更新玩家数据:', Object.keys(playerUpdates))

      // 同步 pendingSwaps 到 Firebase（先声夺人技能需要）
      debugLog('[PlayerMode] 技能执行前检查 roomData.gameState:', roomData.gameState)

      if (!roomData.gameState) {
        debugLog('[PlayerMode] gameState不存在，创建新的gameState对象')
        roomData.gameState = {
          currentRound: 1,
          battleProcessed: false,
          battleLock: null,
          playerStates: {},
          knownCities: {},
          ironCities: {},
          strengthBoost: {},
          morale: {},
          yqgzMarks: [],
          battleLogs: [],
          pendingSwaps: []
        }
      }

      if (!roomData.gameState.pendingSwaps) {
        debugLog('[PlayerMode] pendingSwaps不存在，创建新数组')
        roomData.gameState.pendingSwaps = []
      }

      // 关键修复：正确读取pendingSwaps (Pinia会自动解包ref)
      let pendingSwapsUpdate = []
      if (Array.isArray(gameStore.pendingSwaps)) {
        pendingSwapsUpdate = gameStore.pendingSwaps
        debugLog('[PlayerMode] pendingSwaps已被Pinia解包,直接使用数组')
      } else if (gameStore.pendingSwaps?.value && Array.isArray(gameStore.pendingSwaps.value)) {
        pendingSwapsUpdate = gameStore.pendingSwaps.value
        debugLog('[PlayerMode] pendingSwaps是未解包的ref,使用.value')
      } else {
        pendingSwapsUpdate = []
        console.warn('[PlayerMode] pendingSwaps既不是数组也不是ref,使用空数组')
      }

      debugLog('[PlayerMode] 技能执行前 gameStore.pendingSwaps:', gameStore.pendingSwaps)
      debugLog('[PlayerMode] 技能执行前 pendingSwaps类型:', Array.isArray(gameStore.pendingSwaps) ? 'Array' : typeof gameStore.pendingSwaps)
      debugLog('[PlayerMode] 同步pendingSwaps到Firebase:', pendingSwapsUpdate.length, '条请求', pendingSwapsUpdate)

      // 关键修复：一次性更新所有数据（玩家数据 + pendingSwaps），避免触发多次监听器
      // 将pendingSwaps也加入到playerUpdates中，一起更新
      playerUpdates[`rooms/${currentRoomId.value}/gameState/pendingSwaps`] = pendingSwapsUpdate

      debugLog('[PlayerMode] 准备一次性更新到Firebase:', Object.keys(playerUpdates).length, '个字段')

      if (Object.keys(playerUpdates).length > 0) {
        const { getDatabase, ref: dbRef, update } = await import('firebase/database')
        const db = getDatabase()
        await update(dbRef(db), playerUpdates)
        debugLog('[PlayerMode] 所有数据已一次性同步到Firebase（玩家数据 + pendingSwaps）')
      }
    } else {
      gameStore.addLog(result?.message || `${skillName} 执行失败`)
      console.error('[PlayerMode] 技能执行失败:', result)
    }
  } catch (error) {
    console.error('[PlayerMode] 技能执行异常:', error)
    gameStore.addLog(`技能执行异常: ${error.message}`)
  }
}

/**
 * 处理技能执行失败
 */
function handleSkillFailed(failureData) {
  debugLog('[PlayerMode] 技能执行失败', failureData)

  // 设置失败信息
  skillFailureInfo.value = {
    skillName: failureData.skill,
    message: failureData.result?.message || failureData.error || '技能执行失败',
    timestamp: Date.now()
  }

  // 显示失败弹窗
  showSkillFailureModal.value = true

  // 添加到游戏日志
  gameStore.addLog(`❌ ${failureData.skill} 执行失败: ${skillFailureInfo.value.message}`)
}

/**
 * 关闭技能失败弹窗
 */
function closeSkillFailureModal() {
  showSkillFailureModal.value = false
  skillFailureInfo.value = null
}

// ========== 无懈可击拦截系统 ==========

/**
 * 判断是否需要触发无懈可击拦截弹窗
 * @param {string} skillName - 当前使用的技能名
 * @param {string} opponentName - 对手名称
 * @returns {boolean}
 */
function shouldIntercept(skillName, opponentName) {
  // 事半功倍、无懈可击本身、先声夺人（有独立的pendingSwap交互流程）、时来运转/人质交换（有独立的FortuneSwap弹窗）不触发拦截
  if (skillName === '事半功倍' || skillName === '无懈可击' || skillName === '先声夺人') return false
  if (skillName === '时来运转' || skillName === '人质交换' || skillName === '狐假虎威') return false

  // 检查对手的无懈可击是否被事半功倍禁用
  if (gameStore.bannedSkills?.[opponentName]?.['无懈可击']) return false

  // 检查对手的无懈可击冷却是否已到
  if (gameStore.cooldowns?.[opponentName]?.['无懈可击'] > 0) return false

  // 检查对手金币是否足够支付无懈可击费用
  // 技能成本 ≤ 15金币时拦截费用为11，> 15金币时拦截费用为19
  const opponent = gameStore.players.find(p => p.name === opponentName)
  if (!opponent) return false
  const skillCost = SKILL_COSTS[skillName] || 0
  const interceptCost = getInterceptCost(skillCost)
  if (opponent.gold < interceptCost) return false

  return true
}

// ========== 博学多才答题流程 ==========
function shuffleBxdcOptions(q) {
  const opts = [...q.options]
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[opts[i], opts[j]] = [opts[j], opts[i]]
  }
  return { ...q, options: opts }
}

/**
 * 启动博学多才答题，返回Promise，resolve时传回correctCount
 * @param {string} cityName - 城市名称（用于决定题库）
 * @param {string} playerName - 玩家名称（用于检查拔旗易帜）
 */
function startBxdcQuizAsync(cityName, playerName) {
  return new Promise((resolve) => {
    bxdcResolve = resolve

    let questionSource = null
    if (hasCityQuestions(cityName)) {
      questionSource = CITY_QUESTIONS[cityName]
    } else {
      let provinceName = null
      if (gameStore.changeFlagMark?.[playerName]?.[cityName]) {
        provinceName = gameStore.changeFlagMark[playerName][cityName].newProvince
      } else {
        const provData = PROVINCE_MAP[cityName]
        provinceName = provData ? provData.name : null
      }
      if (provinceName && CITY_QUESTIONS[provinceName]) {
        questionSource = CITY_QUESTIONS[provinceName]
      }
    }
    if (!questionSource) {
      questionSource = CITY_QUESTIONS['DEFAULT'] || {}
    }

    const picked = []
    for (const diff of ['普通', '进阶', '挑战']) {
      const pool = questionSource[diff]
      if (pool && pool.length > 0) {
        const q = pool[Math.floor(Math.random() * pool.length)]
        picked.push({ ...shuffleBxdcOptions(q), difficulty: diff, timeLimit: diff === '挑战' ? 15 : 12 })
      }
    }

    if (picked.length === 0) {
      bxdcResolve = null
      resolve(0)
      return
    }

    bxdcQuestions.value = picked
    bxdcCurrentIndex.value = 0
    bxdcCorrectCount.value = 0
    bxdcAnswered.value = false
    bxdcSelectedAnswer.value = null
    bxdcFinished.value = false
    bxdcShow.value = true
    startBxdcTimerPM()
  })
}

function startBxdcTimerPM() {
  clearInterval(bxdcTimer.value)
  const q = bxdcQuestions.value[bxdcCurrentIndex.value]
  bxdcTimeLeft.value = q ? q.timeLimit : 12
  bxdcTimer.value = setInterval(() => {
    bxdcTimeLeft.value--
    if (bxdcTimeLeft.value <= 0) {
      clearInterval(bxdcTimer.value)
      if (!bxdcAnswered.value) {
        bxdcAnswered.value = true
        bxdcSelectedAnswer.value = null
        setTimeout(() => nextBxdcQuestionPM(), 800)
      }
    }
  }, 1000)
}

function selectBxdcAnswerPM(answer) {
  if (bxdcAnswered.value) return
  bxdcAnswered.value = true
  bxdcSelectedAnswer.value = answer
  clearInterval(bxdcTimer.value)

  const q = bxdcQuestions.value[bxdcCurrentIndex.value]
  if (answer === q.answer) {
    bxdcCorrectCount.value++
  }
  setTimeout(() => nextBxdcQuestionPM(), 800)
}

function nextBxdcQuestionPM() {
  if (bxdcCurrentIndex.value >= bxdcQuestions.value.length - 1) {
    bxdcFinished.value = true
    clearInterval(bxdcTimer.value)
    return
  }
  bxdcCurrentIndex.value++
  bxdcAnswered.value = false
  bxdcSelectedAnswer.value = null
  startBxdcTimerPM()
}

function confirmBxdcResultPM() {
  bxdcShow.value = false
  clearInterval(bxdcTimer.value)
  if (bxdcResolve) {
    bxdcResolve(bxdcCorrectCount.value)
    bxdcResolve = null
  }
}

/**
 * Player B处理：接受（不拦截）
 */
async function handleInterceptAccepted(interceptData) {
  debugLog('[PlayerMode] 无懈可击：接受技能效果', interceptData)

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    // 更新pendingIntercept状态为accepted
    gameStore.updatePendingInterceptStatus('accepted')

    const acceptedData = JSON.parse(JSON.stringify({ ...interceptData, status: 'accepted' }))
    await update(dbRef(db), {
      [`rooms/${currentRoomId.value}/gameState/pendingIntercept`]: acceptedData
    })

    debugLog('[PlayerMode] 已同步accepted状态到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步intercept accepted失败:', error)
  }
}

/**
 * Player B处理：使用无懈可击拦截
 */
async function handleInterceptCountered(interceptData) {
  debugLog('[PlayerMode] 无懈可击：拦截技能', interceptData)

  const opponent = gameStore.players.find(p => p.name === currentPlayer.value?.name)
  if (!opponent) return

  // 扣除拦截金币
  opponent.gold -= interceptData.interceptCost
  currentPlayer.value.gold = opponent.gold

  // 设置冷却 5 回合
  if (!gameStore.cooldowns[currentPlayer.value.name]) {
    gameStore.cooldowns[currentPlayer.value.name] = {}
  }
  gameStore.cooldowns[currentPlayer.value.name]['无懈可击'] = 5

  // 添加日志
  gameStore.addLog(`${currentPlayer.value.name}使用了无懈可击（花费${interceptData.interceptCost}金币），成功拦截了${interceptData.casterName}的"${interceptData.skillName}"`)

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    // 找到当前玩家的索引
    const playerIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value.name)

    const counteredData = JSON.parse(JSON.stringify({ ...interceptData, status: 'countered' }))
    const updates = {
      [`rooms/${currentRoomId.value}/gameState/pendingIntercept`]: counteredData,
      [`rooms/${currentRoomId.value}/gameState/cooldowns`]: JSON.parse(JSON.stringify(gameStore.cooldowns)),
      [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
    }

    // 同步对手（拦截方）金币
    if (playerIdx >= 0) {
      updates[`rooms/${currentRoomId.value}/players/${playerIdx}/gold`] = opponent.gold
    }

    await update(dbRef(db), updates)
    debugLog('[PlayerMode] 已同步countered状态到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步intercept countered失败:', error)
  }
}

// ========== 时来运转/人质交换弹窗系统 ==========

/**
 * Player B处理：接受交换
 */
async function handleFortuneSwapAccepted(swapData) {
  debugLog('[PlayerMode] 时来运转/人质交换：接受交换', swapData)

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    gameStore.updatePendingFortuneSwapStatus('accepted')

    const acceptedData = JSON.parse(JSON.stringify({ ...swapData, status: 'accepted' }))
    await update(dbRef(db), {
      [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: acceptedData
    })

    debugLog('[PlayerMode] 已同步accepted状态到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步fortune swap accepted失败:', error)
  }
}

/**
 * Player B处理：使用李代桃僵（自选城市）
 */
async function handleFortuneSwapLiDai(swapData) {
  debugLog('[PlayerMode] 时来运转/人质交换：李代桃僵', swapData)

  const player = gameStore.players.find(p => p.name === currentPlayer.value?.name)
  if (!player) return

  // 扣除李代桃僵金币（6金币）
  player.gold -= 6
  currentPlayer.value.gold = player.gold

  // 记录使用次数和设置冷却
  gameStore.recordSkillUsage(currentPlayer.value.name, '李代桃僵')
  gameStore.setSkillCooldown(currentPlayer.value.name, '李代桃僵', 3)

  // 添加日志
  gameStore.addLog(`${currentPlayer.value.name}使用了李代桃僵（花费6金币），自选城市参与交换`)

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    const playerIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value.name)

    const liDaiData = JSON.parse(JSON.stringify({
      ...swapData,
      status: 'li_dai_tao_jiang',
      selectedCities: swapData.selectedCities
    }))

    const updates = {
      [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: liDaiData,
      [`rooms/${currentRoomId.value}/gameState/cooldowns`]: JSON.parse(JSON.stringify(gameStore.cooldowns)),
      [`rooms/${currentRoomId.value}/gameState/skillUsageTracking`]: JSON.parse(JSON.stringify(gameStore.skillUsageTracking)),
      [`rooms/${currentRoomId.value}/gameState/roundGoldSpent`]: JSON.parse(JSON.stringify(gameStore.roundGoldSpent)),
      [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
    }

    if (playerIdx >= 0) {
      updates[`rooms/${currentRoomId.value}/players/${playerIdx}/gold`] = player.gold
    }

    await update(dbRef(db), updates)
    debugLog('[PlayerMode] 已同步li_dai_tao_jiang状态到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步fortune swap li_dai失败:', error)
  }
}

/**
 * Player B处理：使用无懈可击取消交换
 */
async function handleFortuneSwapCountered(swapData) {
  debugLog('[PlayerMode] 时来运转/人质交换：无懈可击取消', swapData)

  const player = gameStore.players.find(p => p.name === currentPlayer.value?.name)
  if (!player) return

  // 扣除无懈可击金币（11金币）
  player.gold -= 11
  currentPlayer.value.gold = player.gold

  // 设置无懈可击冷却
  if (!gameStore.cooldowns[currentPlayer.value.name]) {
    gameStore.cooldowns[currentPlayer.value.name] = {}
  }
  gameStore.cooldowns[currentPlayer.value.name]['无懈可击'] = 5

  // 添加日志
  gameStore.addLog(`${currentPlayer.value.name}使用了无懈可击（花费11金币），取消了${swapData.casterName}的${swapData.type}`)

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    const playerIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value.name)

    const counteredData = JSON.parse(JSON.stringify({ ...swapData, status: 'countered' }))
    const updates = {
      [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: counteredData,
      [`rooms/${currentRoomId.value}/gameState/cooldowns`]: JSON.parse(JSON.stringify(gameStore.cooldowns)),
      [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
    }

    if (playerIdx >= 0) {
      updates[`rooms/${currentRoomId.value}/players/${playerIdx}/gold`] = player.gold
    }

    await update(dbRef(db), updates)
    debugLog('[PlayerMode] 已同步countered状态到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步fortune swap countered失败:', error)
  }
}

/**
 * Player A: 执行被接受/李代桃僵的交换
 */
async function executeFortuneSwapResult(swapData) {
  debugLog('[PlayerMode] 执行时来运转/人质交换结果:', swapData.status)

  waitingForFortuneSwap.value = false

  const nonBattleSkills = await import('../../composables/skills/nonBattleSkills.js')

  let result = null
  if (swapData.status === 'accepted') {
    // 使用预计算的城市执行交换
    if (swapData.type === '时来运转') {
      result = nonBattleSkills.useNonBattleSkills().executeFortuneSwap(
        swapData.casterName, swapData.targetName,
        swapData.casterCities, swapData.targetCities
      )
    } else {
      result = nonBattleSkills.useNonBattleSkills().executeHostageSwap(
        swapData.casterName, swapData.targetName,
        swapData.casterCities[0], swapData.targetCities[0]
      )
    }
  } else if (swapData.status === 'li_dai_tao_jiang') {
    // B选择了自己的城市，A侧城市不变
    if (swapData.type === '时来运转') {
      result = nonBattleSkills.useNonBattleSkills().executeFortuneSwap(
        swapData.casterName, swapData.targetName,
        swapData.casterCities, swapData.selectedCities
      )
    } else {
      result = nonBattleSkills.useNonBattleSkills().executeHostageSwap(
        swapData.casterName, swapData.targetName,
        swapData.casterCities[0], swapData.selectedCities[0]
      )
    }
  } else if (swapData.status === 'countered') {
    // 被无懈可击取消，退还A的使用次数（但不退金币）
    gameStore.addLog(`${swapData.casterName}的${swapData.type}被${swapData.targetName}的无懈可击取消`)
    // 清除pendingFortuneSwap
    gameStore.clearPendingFortuneSwap()

    // 同步清除到Firebase
    try {
      const { getDatabase, ref: dbRef, update } = await import('firebase/database')
      const db = getDatabase()
      await update(dbRef(db), {
        [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: null,
        [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
      })
    } catch (error) {
      console.error('[PlayerMode] 清除pendingFortuneSwap失败:', error)
    }
    return
  }

  if (result) {
    debugLog('[PlayerMode] 交换执行结果:', result)
    if (!result.success) {
      console.error('[PlayerMode] 交换执行失败:', result.message)
      gameStore.addLog(`交换执行失败：${result.message}`)
      // 失败时也清除pendingFortuneSwap
      gameStore.clearPendingFortuneSwap()
      try {
        const { getDatabase, ref: dbRef, update } = await import('firebase/database')
        const db = getDatabase()
        await update(dbRef(db), {
          [`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`]: null,
          [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs]
        })
      } catch (error) {
        console.error('[PlayerMode] 清除pendingFortuneSwap失败:', error)
      }
      return
    }
  }

  // 清除pendingFortuneSwap
  gameStore.clearPendingFortuneSwap()

  // 同步所有数据到Firebase
  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    const playerUpdates = {}
    gameStore.players.forEach((player, idx) => {
      const citiesForFirebase = {}
      Object.entries(player.cities).forEach(([cityName, city]) => {
        citiesForFirebase[cityName] = {
          ...city,
          currentHp: city.currentHp,
          isAlive: city.isAlive !== false
        }
      })
      playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/cities`] = citiesForFirebase
      playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/gold`] = player.gold
    })

    playerUpdates[`rooms/${currentRoomId.value}/gameState/pendingFortuneSwap`] = null
    playerUpdates[`rooms/${currentRoomId.value}/gameState/battleLogs`] = [...gameStore.logs]

    // 同步已知城市
    if (gameStore.knownCities && Object.keys(gameStore.knownCities).length > 0) {
      const knownCitiesForFirebase = {}
      Object.keys(gameStore.knownCities).forEach(observer => {
        knownCitiesForFirebase[observer] = {}
        Object.keys(gameStore.knownCities[observer]).forEach(owner => {
          const cities = gameStore.knownCities[observer][owner]
          knownCitiesForFirebase[observer][owner] = cities instanceof Set ? Array.from(cities) : (Array.isArray(cities) ? cities : [])
        })
      })
      playerUpdates[`rooms/${currentRoomId.value}/gameState/knownCities`] = knownCitiesForFirebase
    }

    await update(dbRef(db), playerUpdates)
    debugLog('[PlayerMode] 交换结果已同步到Firebase')
  } catch (error) {
    console.error('[PlayerMode] 同步交换结果失败:', error)
  }
}

/**
 * Player A: 启动等待对手响应的计时器
 */
function startInterceptWaitTimer() {
  waitingForIntercept.value = true
  const intercept = gameStore.pendingIntercept
  if (!intercept) return

  const updateTimer = () => {
    const now = Date.now()
    const remaining = Math.max(0, intercept.expiresAt - now)
    const total = intercept.expiresAt - intercept.createdAt
    interceptWaitSeconds.value = Math.ceil(remaining / 1000)
    interceptWaitPercent.value = Math.max(0, (remaining / total) * 100)

    if (remaining <= 0) {
      stopInterceptWaitTimer()
      // 关键修复：施法者端倒计时结束时，主动将Firebase状态更新为expired
      // 这确保即使对手端InterceptPopup的auto-accept因时钟差异未触发，
      // 施法者端仍然能通过listener检测到状态变化并执行技能
      handleInterceptTimerExpired()
    }
  }

  updateTimer()
  interceptWaitTimer = setInterval(updateTimer, 1000)
}

/**
 * Player A: 施法者端倒计时结束，主动更新Firebase状态为expired并执行技能
 */
async function handleInterceptTimerExpired() {
  const intercept = gameStore.pendingIntercept
  if (!intercept || intercept.status !== 'pending') return

  debugLog('[PlayerMode] 施法者端倒计时结束，主动设置expired并执行技能')

  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    // 更新本地状态
    gameStore.updatePendingInterceptStatus('expired')

    // 更新Firebase状态为expired
    const expiredData = JSON.parse(JSON.stringify({ ...intercept, status: 'expired' }))
    await update(dbRef(db), {
      [`rooms/${currentRoomId.value}/gameState/pendingIntercept`]: expiredData
    })

    debugLog('[PlayerMode] 已同步expired状态到Firebase')

    // 直接执行技能（不等待listener，避免竞态条件）
    executePendingSkill({ ...intercept, status: 'expired' })
  } catch (error) {
    console.error('[PlayerMode] handleInterceptTimerExpired失败:', error)
  }
}

/**
 * Player A: 停止等待计时器
 */
function stopInterceptWaitTimer() {
  waitingForIntercept.value = false
  interceptWaitSeconds.value = 0
  interceptWaitPercent.value = 100
  if (interceptWaitTimer) {
    clearInterval(interceptWaitTimer)
    interceptWaitTimer = null
  }
}

/**
 * Player A: 执行被接受/过期的技能
 * 从pendingIntercept.skillData恢复参数并调用对应技能函数
 */
async function executePendingSkill(interceptData) {
  // 防止重复执行（syncRoomDataToGameStore和listener可能同时检测到状态变化）
  if (executingPendingSkill) {
    debugLog('[PlayerMode] executePendingSkill 已在执行中，跳过重复调用')
    return
  }
  executingPendingSkill = true
  debugLog('[PlayerMode] 执行待拦截技能:', interceptData.skillName)

  stopInterceptWaitTimer()

  const { skillData } = interceptData
  if (!skillData) {
    console.error('[PlayerMode] executePendingSkill: 缺少skillData')
    gameStore.clearPendingIntercept()
    executingPendingSkill = false
    return
  }

  // 恢复施法者和目标（使用let以便在异步操作后重新获取引用）
  let caster = gameStore.players.find(p => p.name === interceptData.casterName)
  if (!caster) {
    console.error('[PlayerMode] executePendingSkill: 找不到施法者')
    gameStore.clearPendingIntercept()
    executingPendingSkill = false
    return
  }

  let target = null
  if (interceptData.targetName && interceptData.targetName !== interceptData.casterName) {
    target = gameStore.players.find(p => p.name === interceptData.targetName)
  }

  const { skillName, targetCityName, selfCityName, selectedSelfCities, amount } = skillData

  // 动态导入技能模块
  const battleSkills = await import('../../composables/skills/battleSkills.js')
  const nonBattleSkills = await import('../../composables/skills/nonBattleSkills.js')

  // 战斗金币技能映射
  const battleSkillMap = {
    '擒贼擒王': () => battleSkills.useBattleSkills().executeQinZeiQinWang(caster, target),
    '草木皆兵': () => battleSkills.useBattleSkills().executeCaoMuJieBing(caster, target),
    '越战越勇': () => battleSkills.useBattleSkills().executeYueZhanYueYong(caster, caster.cities?.[selfCityName]),
    '吸引攻击': () => battleSkills.useBattleSkills().executeXiYinGongJi(caster, caster.cities?.[selfCityName]),
    '铜墙铁壁': () => battleSkills.useBattleSkills().executeTongQiangTieBi(caster, target),
    '设置屏障': () => battleSkills.useBattleSkills().executeSetBarrier(caster),
    '潜能激发': () => battleSkills.useBattleSkills().executeQianNengJiFa(caster),
    '御驾亲征': () => battleSkills.useBattleSkills().executeYuJiaQinZheng(caster, target),
    '围魏救赵': () => battleSkills.useBattleSkills().executeWeiWeiJiuZhao(caster, target),
  }

  // 非战斗金币技能映射 (完整版 - 与handleSkillSelected中的nonBattleSkillMap保持同步)
  // 注意：selfCity在此上下文中需要用 caster.cities?.[selfCityName] 代替
  const nonBattleSkillMap = {
    // ========== 1. 资源管理类 ==========
    '转账给他人': () => nonBattleSkills.useNonBattleSkills().executeTransferGold(caster, target, amount),
    '金币贷款': () => nonBattleSkills.useNonBattleSkills().executeJinBiDaiKuan(caster),
    '金融危机': () => nonBattleSkills.useNonBattleSkills().executeJinRongWeiJi(caster),
    '釜底抽薪': () => nonBattleSkills.useNonBattleSkills().executeFuDiChouXin(caster, target),
    '趁火打劫': () => nonBattleSkills.useNonBattleSkills().executeChenHuoDaJie(caster, target),
    '计划单列': () => nonBattleSkills.useNonBattleSkills().executeJiHuaDanLie(caster, selfCityName),
    '无中生有': () => nonBattleSkills.useNonBattleSkills().executeWuZhongShengYou(caster),
    '劫富济贫': () => nonBattleSkills.useNonBattleSkills().executeJieFuJiPin(caster, target),

    // ========== 2. 治疗/HP增强类 ==========
    '快速治疗': () => nonBattleSkills.useNonBattleSkills().executeKuaiSuZhiLiao(caster, caster.cities?.[selfCityName]),
    '高级治疗': () => nonBattleSkills.useNonBattleSkills().executeGaoJiZhiLiao(caster, selectedSelfCities || [selfCityName]),
    '借尸还魂': () => nonBattleSkills.useNonBattleSkills().executeJieShiHuanHun(caster, caster.cities?.[selfCityName]),
    '实力增强': () => nonBattleSkills.useNonBattleSkills().executeShiLiZengQiang(caster, caster.cities?.[selfCityName]),
    '士气大振': () => nonBattleSkills.useNonBattleSkills().executeShiQiDaZhen(caster),
    '苟延残喘': () => nonBattleSkills.useNonBattleSkills().executeGouYanCanChuan(caster),
    '众志成城': () => nonBattleSkills.useNonBattleSkills().executeZhongZhiChengCheng(caster, selectedSelfCities),
    '焕然一新': () => nonBattleSkills.useNonBattleSkills().executeHuanRanYiXin(caster, caster.cities?.[selfCityName]),
    '厚积薄发': () => nonBattleSkills.useNonBattleSkills().executeHouJiBaoFa(caster, caster.cities?.[selfCityName]),
    '血量存储': () => nonBattleSkills.useNonBattleSkills().executeXueLiangCunChu(caster, caster.cities?.[selfCityName]),

    // ========== 3. 保护/防御类 ==========
    '城市保护': () => nonBattleSkills.useNonBattleSkills().executeCityProtection(caster, caster.cities?.[selfCityName]),
    '钢铁城市': () => nonBattleSkills.useNonBattleSkills().executeGangTieChengShi(caster, caster.cities?.[selfCityName]),
    '定海神针': () => nonBattleSkills.useNonBattleSkills().executeDingHaiShenZhen(caster, caster.cities?.[selfCityName]),
    '坚不可摧': () => nonBattleSkills.useNonBattleSkills().executeJianBuKeCui(caster),
    '步步高升': () => nonBattleSkills.useNonBattleSkills().executeBuBuGaoSheng(caster, caster.cities?.[selfCityName]),
    '海市蜃楼': () => nonBattleSkills.useNonBattleSkills().executeHaiShiShenLou(caster),
    '副中心制': () => nonBattleSkills.useNonBattleSkills().executeFuZhongXinZhi(caster, caster.cities?.[selfCityName]),
    '生于紫室': () => nonBattleSkills.useNonBattleSkills().executeShengYuZiShi(caster, caster.cities?.[selfCityName]),
    '深藏不露': () => nonBattleSkills.useNonBattleSkills().executeShenCangBuLu(caster, caster.cities?.[selfCityName]),
    '技能保护': () => nonBattleSkills.useNonBattleSkills().executeJiNengBaoHu(caster),

    // ========== 4. 攻击/伤害类 ==========
    '无知无畏': () => nonBattleSkills.useNonBattleSkills().executeWuZhiWuWei(caster, target),
    '一落千丈': () => nonBattleSkills.useNonBattleSkills().executeYiLuoQianZhang(caster, target, target.cities?.[targetCityName]),
    '连续打击': () => nonBattleSkills.useNonBattleSkills().executeLianXuDaJi(caster, target, skillData.selectedTargetCities),
    '波涛汹涌': () => nonBattleSkills.useNonBattleSkills().executeBoTaoXiongYong(caster, target),
    '狂轰滥炸': () => nonBattleSkills.useNonBattleSkills().executeKuangHongLanZha(caster, target),
    '横扫一空': () => nonBattleSkills.useNonBattleSkills().executeHengSaoYiKong(caster, target),
    '万箭齐发': () => nonBattleSkills.useNonBattleSkills().executeWanJianQiFa(caster, target, target.cities?.[targetCityName]),
    '降维打击': () => nonBattleSkills.useNonBattleSkills().executeJiangWeiDaJi(caster, target, target.cities?.[targetCityName]),
    '定时爆破': () => nonBattleSkills.useNonBattleSkills().executeDingShiBaoPo(caster, target, target.cities?.[targetCityName]),
    '灰飞烟灭': () => nonBattleSkills.useNonBattleSkills().executeYongJiuCuiHui(caster, target, target.cities?.[targetCityName]),
    '连锁反应': () => nonBattleSkills.useNonBattleSkills().executeLianSuoFanYing(caster, target, target.cities?.[targetCityName]),
    '进制扭曲': () => nonBattleSkills.useNonBattleSkills().executeJinZhiNiuQu(caster, target, target.cities?.[targetCityName]),

    '天灾人祸': () => nonBattleSkills.useNonBattleSkills().executeTianZaiRenHuo(caster, target, target.cities?.[targetCityName]),
    '自相残杀': () => nonBattleSkills.useNonBattleSkills().executeZiXiangCanSha(caster, target),
    '中庸之道': () => nonBattleSkills.useNonBattleSkills().executeZhongYongZhiDao(caster, target),

    '招贤纳士': () => nonBattleSkills.useNonBattleSkills().executeZhaoXianNaShi(caster, target),
    '清除加成': () => nonBattleSkills.useNonBattleSkills().executeQingChuJiaCheng(caster, target),

    // ========== 5. 控制/交换类 ==========
    '先声夺人': () => nonBattleSkills.useNonBattleSkills().executeXianShengDuoRen(caster, target, { casterCityName: selfCityName }),
    '人质交换': () => nonBattleSkills.useNonBattleSkills().executeRenZhiJiaoHuan(caster, target, selfCityName, targetCityName),
    '改弦更张': () => nonBattleSkills.useNonBattleSkills().executeGaiXianGengZhang(caster),
    '拔旗易帜': () => nonBattleSkills.useNonBattleSkills().executeBaQiYiZhi(caster, target, { myCityName: selfCityName, oppCityName: targetCityName }),
    '避而不见': () => nonBattleSkills.useNonBattleSkills().executeBiErBuJian(caster, target, target.cities?.[targetCityName]),
    '狐假虎威': () => nonBattleSkills.useNonBattleSkills().executeHuJiaHuWei(caster, caster.cities?.[selfCityName]),
    '李代桃僵': () => nonBattleSkills.useNonBattleSkills().executeLiDaiTaoJiang(caster, selfCityName, targetCityName),
    '点石成金': () => nonBattleSkills.useNonBattleSkills().executeHaoGaoWuYuan(caster, caster.cities?.[selfCityName]),
    '数位反转': () => nonBattleSkills.useNonBattleSkills().executeShuWeiFanZhuan(caster, target, target.cities?.[targetCityName]),
    '战略转移': () => nonBattleSkills.useNonBattleSkills().executeZhanLueZhuanYi(caster, caster.cities?.[selfCityName]),
    '倒反天罡': () => nonBattleSkills.useNonBattleSkills().executeDaoFanTianGang(caster, target, targetCityName),
    '移花接木': () => nonBattleSkills.useNonBattleSkills().executeYiHuaJieMu(caster, target),
    '寸步难行': () => nonBattleSkills.useNonBattleSkills().executeChunBuNanXing(caster, target),
    '强制转移·普通': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiQianDuPutong(caster, target),
    '强制转移·高级': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiQianDuGaoji(caster, target, target.cities?.[targetCityName]),
    '强制搬运': () => nonBattleSkills.useNonBattleSkills().executeQiangZhiBanYun(caster, target, target.cities?.[targetCityName]),
    '言听计从': () => nonBattleSkills.useNonBattleSkills().executeYanTingJiCong(caster, target, targetCityName),

    // ========== 6. 情报/侦查类 ==========
    '城市侦探': () => nonBattleSkills.useNonBattleSkills().executeCityDetective(caster, target, targetCityName),
    '城市预言': () => nonBattleSkills.useNonBattleSkills().executeCityProphecy(caster, target),
    '明察秋毫': () => nonBattleSkills.useNonBattleSkills().executeMingChaQiuHao(caster, target),
    '一举两得': () => nonBattleSkills.useNonBattleSkills().executeYiJuLiangDe(caster, target),
    '不露踪迹': () => nonBattleSkills.useNonBattleSkills().executeBuLuZongJi(caster, selfCityName),
    '博学多才': () => nonBattleSkills.useNonBattleSkills().executeBoXueDuoCai(caster, selfCityName, skillData.correctCount),

    // ========== 7. 省份相关类 ==========
    '四面楚歌': () => nonBattleSkills.useNonBattleSkills().executeSiMianChuGe(caster, target),
    '搬运救兵': () => nonBattleSkills.useNonBattleSkills().executeBanyunJiubingPutong(caster, caster.cities?.[selfCityName]),
    '大义灭亲': () => nonBattleSkills.useNonBattleSkills().executeDaYiMieQin(caster, caster.cities?.[selfCityName]),
    '代行省权': () => nonBattleSkills.useNonBattleSkills().executeDaiXingShengQuan(caster, caster.cities?.[selfCityName]),
    '守望相助': () => nonBattleSkills.useNonBattleSkills().executeShouWangXiangZhu(caster, caster.cities?.[selfCityName]),
    '行政中心': () => nonBattleSkills.useNonBattleSkills().executeXingZhengZhongXin(caster, selfCityName),
    '以礼来降': () => nonBattleSkills.useNonBattleSkills().executeYiLiLaiJiang(caster, target, targetCityName),
    '趁其不备': () => nonBattleSkills.useNonBattleSkills().executeChenqibubeiSuiji(caster, target),

    // ========== 8. 特殊机制类 ==========
    '事半功倍': () => nonBattleSkills.useNonBattleSkills().executeShiBanGongBei(caster, skillData.selectedSkillName || selfCityName),
    '过河拆桥': () => nonBattleSkills.useNonBattleSkills().executeGuoHeChaiQiao(caster),
    '解除封锁': () => nonBattleSkills.useNonBattleSkills().executeJieChuFengSuo(caster, skillData.selectedSkillName || selfCityName),
    '一触即发': () => nonBattleSkills.useNonBattleSkills().executeYiChuJiFa(caster, skillData.selectedSkillName || targetCityName),
    '突破瓶颈': () => nonBattleSkills.useNonBattleSkills().executeTuPoPingJing(caster, skillData.selectedSkillName || selfCityName),
    '当机立断': () => nonBattleSkills.useNonBattleSkills().executeDangJiLiDuan(caster, target),
    '电磁感应': () => nonBattleSkills.useNonBattleSkills().executeDianCiGanYing(caster, target),
    '城市试炼': () => nonBattleSkills.useNonBattleSkills().executeChengShiShiLian(caster, caster.cities?.[selfCityName]),
    '抛砖引玉': () => nonBattleSkills.useNonBattleSkills().executePaoZhuanYinYu(caster),
  }

  // 博学多才：拦截通过后进行答题，将答题结果注入skillData
  if (skillName === '博学多才') {
    const quizCorrectCount = await startBxdcQuizAsync(selfCityName, caster.name)
    skillData.correctCount = quizCorrectCount
    // 关键修复：答题期间Firebase监听器会调用syncRoomDataToGameStore，
    // 用新对象替换gameStore.players[idx]，导致caster/target变为过期引用。
    // 过期引用上的金币扣除和HP修改不会反映到gameStore.players，
    // 后续Firebase同步读取gameStore.players时金币/HP仍是旧值。
    // 必须重新从gameStore.players获取最新引用。
    caster = gameStore.players.find(p => p.name === interceptData.casterName)
    if (!caster) {
      console.error('[PlayerMode] executePendingSkill: 答题后找不到施法者')
      gameStore.clearPendingIntercept()
      executingPendingSkill = false
      return
    }
    if (interceptData.targetName && interceptData.targetName !== interceptData.casterName) {
      target = gameStore.players.find(p => p.name === interceptData.targetName)
    }
  }

  let result = null
  try {
    if (battleSkillMap[skillName]) {
      result = battleSkillMap[skillName]()
    } else if (nonBattleSkillMap[skillName]) {
      result = nonBattleSkillMap[skillName]()
    } else {
      console.warn('[PlayerMode] executePendingSkill: 未找到技能实现:', skillName)
      gameStore.addLog(`技能 ${skillName} 执行失败（未找到实现）`)
      gameStore.clearPendingIntercept()
      executingPendingSkill = false
      return
    }

    if (result && result.success) {
      debugLog('[PlayerMode] 待拦截技能执行成功:', result)
      // 不再额外添加result.message日志：技能函数内部已通过addSkillUsageLog添加了完整日志
      // 此处再调用addLog会导致同一条技能使用记录输出两次

      // 关键修复：记录技能使用次数（SkillSelector中的记录已被Firebase监听器覆盖）
      gameStore.recordSkillUsage(caster.name, skillName)

      // 关键修复：设置技能冷却
      const { getSkillRestrictions } = await import('../../data/skills.js')
      const restrictions = getSkillRestrictions(skillName)
      if (restrictions?.cooldown) {
        gameStore.setSkillCooldown(caster.name, skillName, restrictions.cooldown)
      }
    } else {
      debugLog('[PlayerMode] 待拦截技能执行失败:', result)
      gameStore.addLog(`${skillName} 执行失败: ${result?.message || '未知原因'}`)
    }
  } catch (error) {
    console.error('[PlayerMode] executePendingSkill异常:', error)
    gameStore.addLog(`技能执行异常: ${error.message}`)
  }

  // 清除pendingIntercept
  gameStore.clearPendingIntercept()

  // 同步结果到Firebase
  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()

    const playerUpdates = {}
    gameStore.players.forEach((player, idx) => {
      const citiesForFirebase = {}
      Object.entries(player.cities).forEach(([cityName, city]) => {
        citiesForFirebase[cityName] = {
          ...city,
          currentHp: city.currentHp,
          isAlive: city.isAlive !== false
        }
      })
      playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/cities`] = citiesForFirebase
      playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/gold`] = player.gold
      if (player.centerCityName !== undefined) {
        playerUpdates[`rooms/${currentRoomId.value}/players/${idx}/centerCityName`] = player.centerCityName
      }
    })

    playerUpdates[`rooms/${currentRoomId.value}/gameState/pendingIntercept`] = null
    playerUpdates[`rooms/${currentRoomId.value}/gameState/battleLogs`] = [...gameStore.logs]
    playerUpdates[`rooms/${currentRoomId.value}/gameState/cooldowns`] = JSON.parse(JSON.stringify(gameStore.cooldowns))

    // 同步常用游戏状态
    playerUpdates[`rooms/${currentRoomId.value}/gameState/bannedSkills`] = gameStore.bannedSkills && Object.keys(gameStore.bannedSkills).length > 0
      ? JSON.parse(JSON.stringify(gameStore.bannedSkills))
      : {}
    if (gameStore.pendingSwaps && Array.isArray(gameStore.pendingSwaps)) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/pendingSwaps`] = gameStore.pendingSwaps
    }

    // 关键修复：同步技能使用次数（recordSkillUsage更新后的值）
    if (gameStore.skillUsageTracking && Object.keys(gameStore.skillUsageTracking).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/skillUsageTracking`] = JSON.parse(JSON.stringify(gameStore.skillUsageTracking))
    }

    // 同步单回合技能花费
    if (gameStore.roundGoldSpent && Object.keys(gameStore.roundGoldSpent).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/roundGoldSpent`] = JSON.parse(JSON.stringify(gameStore.roundGoldSpent))
    }

    // 同步金币贷款状态
    if (gameStore.goldLoanRounds && Object.keys(gameStore.goldLoanRounds).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/goldLoanRounds`] = JSON.parse(JSON.stringify(gameStore.goldLoanRounds))
    }

    // 同步其他可能被技能修改的状态
    if (gameStore.anchored && Object.keys(gameStore.anchored).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/anchored`] = JSON.parse(JSON.stringify(gameStore.anchored))
    }
    if (gameStore.jianbukecui && Object.keys(gameStore.jianbukecui).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/jianbukecui`] = JSON.parse(JSON.stringify(gameStore.jianbukecui))
    }
    if (gameStore.stealth && Object.keys(gameStore.stealth).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/stealth`] = JSON.parse(JSON.stringify(gameStore.stealth))
    }
    if (gameStore.stareDown && Object.keys(gameStore.stareDown).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/stareDown`] = JSON.parse(JSON.stringify(gameStore.stareDown))
    }
    if (gameStore.timeBombs && Object.keys(gameStore.timeBombs).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/timeBombs`] = JSON.parse(JSON.stringify(gameStore.timeBombs))
    }
    if (gameStore.disaster && Object.keys(gameStore.disaster).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/disaster`] = JSON.parse(JSON.stringify(gameStore.disaster))
    }
    if (gameStore.electromagnetic && Object.keys(gameStore.electromagnetic).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/electromagnetic`] = JSON.parse(JSON.stringify(gameStore.electromagnetic))
    }
    if (gameStore.skillProtection && Object.keys(gameStore.skillProtection).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/skillProtection`] = JSON.parse(JSON.stringify(gameStore.skillProtection))
    }
    if (gameStore.centerProjection && Object.keys(gameStore.centerProjection).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/centerProjection`] = JSON.parse(JSON.stringify(gameStore.centerProjection))
    }
    if (gameStore.financialCrisis && gameStore.financialCrisis.roundsLeft > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/financialCrisis`] = JSON.parse(JSON.stringify(gameStore.financialCrisis))
    }
    if (gameStore.botaoxiongyong && Object.keys(gameStore.botaoxiongyong).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/botaoxiongyong`] = JSON.parse(JSON.stringify(gameStore.botaoxiongyong))
    }
    if (gameStore.hjbf && Object.keys(gameStore.hjbf).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/hjbf`] = JSON.parse(JSON.stringify(gameStore.hjbf))
    }
    if (gameStore.bannedCities && Object.keys(gameStore.bannedCities).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/bannedCities`] = JSON.parse(JSON.stringify(gameStore.bannedCities))
    }

    // 关键修复：同步playerStates到Firebase（强制转移等技能设置needsNewCenter标记）
    // 缺少此同步会导致对手无法收到"选择新中心城市"弹窗
    if (gameStore.playerStates && Object.keys(gameStore.playerStates).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/playerStates`] = JSON.parse(JSON.stringify(gameStore.playerStates))
    }

    // 同步deadCities到Firebase（强制转移淘汰中心城市后需要记录）
    if (gameStore.deadCities && Object.keys(gameStore.deadCities).length > 0) {
      const deadCitiesForFirebase = {}
      Object.entries(gameStore.deadCities).forEach(([playerName, cities]) => {
        deadCitiesForFirebase[playerName] = Array.isArray(cities) ? cities : []
      })
      playerUpdates[`rooms/${currentRoomId.value}/gameState/deadCities`] = deadCitiesForFirebase
    }

    // 同步knownCities到Firebase
    if (gameStore.knownCities && Object.keys(gameStore.knownCities).length > 0) {
      const knownCitiesForFirebase = {}
      Object.keys(gameStore.knownCities).forEach(observer => {
        knownCitiesForFirebase[observer] = {}
        Object.keys(gameStore.knownCities[observer]).forEach(owner => {
          const cities = gameStore.knownCities[observer][owner]
          knownCitiesForFirebase[observer][owner] = cities instanceof Set ? Array.from(cities) : (Array.isArray(cities) ? cities : [])
        })
      })
      playerUpdates[`rooms/${currentRoomId.value}/gameState/knownCities`] = knownCitiesForFirebase
    }

    // 同步protections到Firebase
    if (gameStore.protections && Object.keys(gameStore.protections).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/protections`] = JSON.parse(JSON.stringify(gameStore.protections))
    }

    // 同步ironCities到Firebase
    if (gameStore.ironCities && Object.keys(gameStore.ironCities).length > 0) {
      playerUpdates[`rooms/${currentRoomId.value}/gameState/ironCities`] = JSON.parse(JSON.stringify(gameStore.ironCities))
    }

    await update(dbRef(db), playerUpdates)
    debugLog('[PlayerMode] 待拦截技能执行后状态已同步到Firebase')

    // 更新currentPlayer
    const updatedPlayer = gameStore.players.find(p => p.name === currentPlayer.value?.name)
    if (updatedPlayer) {
      currentPlayer.value = JSON.parse(JSON.stringify(updatedPlayer))
    }
  } catch (error) {
    console.error('[PlayerMode] executePendingSkill同步Firebase失败:', error)
  } finally {
    executingPendingSkill = false
  }
}

/**
 * Player A: 处理技能被拦截
 */
async function handleSkillCountered(interceptData) {
  debugLog('[PlayerMode] 技能被拦截:', interceptData.skillName)
  stopInterceptWaitTimer()

  gameStore.addLog(`${currentPlayer.value?.name}的"${interceptData.skillName}"被${interceptData.targetName}的无懈可击拦截了！`)

  // 关键修复：技能被拦截时，金币费用仍需扣除（但技能效果不生效）
  // 由于intercept路径不再写入金币到Firebase，这里需要手动扣除
  const caster = gameStore.players.find(p => p.name === currentPlayer.value?.name)
  if (caster && interceptData.skillCost) {
    caster.gold -= interceptData.skillCost
  }

  // 记录技能使用次数（即使被拦截也消耗使用次数）
  if (caster) {
    gameStore.recordSkillUsage(caster.name, interceptData.skillName)
  }

  // 设置技能冷却（即使被拦截也进入冷却）
  if (caster) {
    const { getSkillRestrictions } = await import('../../data/skills.js')
    const restrictions = getSkillRestrictions(interceptData.skillName)
    if (restrictions?.cooldown) {
      gameStore.setSkillCooldown(caster.name, interceptData.skillName, restrictions.cooldown)
    }
  }

  // 清除pendingIntercept
  gameStore.clearPendingIntercept()

  // 同步金币扣除和使用次数到Firebase
  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()
    const casterIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value?.name)
    const updates = {
      [`rooms/${currentRoomId.value}/gameState/pendingIntercept`]: null,
      [`rooms/${currentRoomId.value}/gameState/battleLogs`]: [...gameStore.logs],
      [`rooms/${currentRoomId.value}/gameState/cooldowns`]: JSON.parse(JSON.stringify(gameStore.cooldowns))
    }
    if (casterIdx >= 0) {
      updates[`rooms/${currentRoomId.value}/players/${casterIdx}/gold`] = caster.gold
    }
    if (gameStore.skillUsageTracking && Object.keys(gameStore.skillUsageTracking).length > 0) {
      updates[`rooms/${currentRoomId.value}/gameState/skillUsageTracking`] = JSON.parse(JSON.stringify(gameStore.skillUsageTracking))
    }
    if (gameStore.roundGoldSpent && Object.keys(gameStore.roundGoldSpent).length > 0) {
      updates[`rooms/${currentRoomId.value}/gameState/roundGoldSpent`] = JSON.parse(JSON.stringify(gameStore.roundGoldSpent))
    }
    await update(dbRef(db), updates)
    debugLog('[PlayerMode] 技能被拦截，已同步金币扣除到Firebase')
  } catch (error) {
    console.error('[PlayerMode] handleSkillCountered同步Firebase失败:', error)
  }

  // 更新currentPlayer
  const updatedPlayer = gameStore.players.find(p => p.name === currentPlayer.value?.name)
  if (updatedPlayer) {
    currentPlayer.value = JSON.parse(JSON.stringify(updatedPlayer))
  }
}

// ========== END 无懈可击拦截系统 ==========

/**
 * 获取存活的非中心城市列表（用于选择新中心城市）
 */
const aliveCitiesForNewCenter = computed(() => {
  if (!currentPlayer.value?.cities) return []
  return Object.entries(currentPlayer.value.cities).filter(([cityName, city]) => {
    const hp = city.currentHp !== undefined ? city.currentHp : city.hp
    return hp > 0 && city.isAlive !== false
  })
})

/**
 * 确认选择新的中心城市
 */
async function confirmNewCenter() {
  if (!newCenterSelected.value || !currentPlayer.value) return

  debugLog('[PlayerMode] 确认新中心城市:', newCenterSelected.value)

  // 更新本地状态
  currentPlayer.value.centerCityName = newCenterSelected.value

  // 更新 gameStore
  const storePlayer = gameStore.players.find(p => p.name === currentPlayer.value.name)
  if (storePlayer) {
    storePlayer.centerCityName = newCenterSelected.value
  }

  // 清除 needsNewCenter 标记
  if (gameStore.playerStates[currentPlayer.value.name]) {
    delete gameStore.playerStates[currentPlayer.value.name].needsNewCenter
    delete gameStore.playerStates[currentPlayer.value.name].newCenterReason
  }

  // 同步到 Firebase
  try {
    const { getDatabase, ref: dbRef, update } = await import('firebase/database')
    const db = getDatabase()
    const playerIdx = gameStore.players.findIndex(p => p.name === currentPlayer.value.name)
    if (playerIdx >= 0) {
      const updates = {}
      updates[`rooms/${currentRoomId.value}/players/${playerIdx}/centerCityName`] = newCenterSelected.value
      updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/needsNewCenter`] = null
      updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/newCenterReason`] = null
      await update(dbRef(db), updates)
      debugLog('[PlayerMode] 新中心城市已同步到Firebase')
    }
  } catch (error) {
    console.error('[PlayerMode] 同步新中心城市失败:', error)
  }

  // 关闭弹窗
  showNewCenterSelection.value = false
  newCenterSelected.value = ''
  newCenterReason.value = ''
}

/**
 * 处理先声夺人交换请求被接受
 */
async function handleSwapAccepted({ swap, result }) {
  debugLog('[PlayerMode] 交换请求已接受', { swap, result })

  if (!currentRoomId.value) {
    console.error('[PlayerMode] 缺少房间信息')
    return
  }

  try {
    // 获取最新房间数据
    const roomData = await getRoomData(currentRoomId.value)
    if (!roomData) {
      console.error('[PlayerMode] 无法获取房间数据')
      return
    }

    // 同步交换后的城市数据到 Firebase
    const initiator = gameStore.players.find(p => p.name === swap.initiatorName)
    const target = gameStore.players.find(p => p.name === swap.targetName)

    if (initiator && target) {
      const initiatorRoom = roomData.players.find(p => p.name === initiator.name)
      const targetRoom = roomData.players.find(p => p.name === target.name)

      if (initiatorRoom && targetRoom) {
        // 同步城市列表 - 保持对象结构
        initiatorRoom.cities = {}
        Object.entries(initiator.cities).forEach(([cityName, city]) => {
          initiatorRoom.cities[cityName] = {
            ...city,
            currentHp: city.currentHp,
            isAlive: city.isAlive !== false
          }
        })

        targetRoom.cities = {}
        Object.entries(target.cities).forEach(([cityName, city]) => {
          targetRoom.cities[cityName] = {
            ...city,
            currentHp: city.currentHp,
            isAlive: city.isAlive !== false
          }
        })

        // 添加交换日志到battleLogs
        if (!roomData.gameState.battleLogs) {
          roomData.gameState.battleLogs = []
        }
        roomData.gameState.battleLogs.push({
          message: result.message,
          timestamp: Date.now(),
          round: roomData.gameState.currentRound || 1,
          isPrivate: false
        })

        // 同步 pendingSwaps 到 Firebase
        if (!roomData.gameState.pendingSwaps) {
          roomData.gameState.pendingSwaps = []
        }
        // 关键修复：Pinia自动解包ref，直接使用gameStore.pendingSwaps
        roomData.gameState.pendingSwaps = gameStore.pendingSwaps

        // 保存到Firebase
        await saveRoomData(currentRoomId.value, roomData)
        debugLog('[PlayerMode] 交换结果已同步到Firebase')

        // 注释：不在这里添加本地日志，因为acceptPreemptiveStrike已经添加过了
        // 避免重复日志：acceptPreemptiveStrike在line 1197-1200已经使用addSkillEffectLog添加了日志
        // gameStore.addLog(result.message)
      }
    }
  } catch (error) {
    console.error('[PlayerMode] 同步交换结果失败:', error)
    gameStore.addLog(`同步交换结果异常: ${error.message}`)
  }
}

/**
 * 处理先声夺人交换请求被拒绝
 */
async function handleSwapRejected({ swap, result }) {
  debugLog('[PlayerMode] 交换请求已拒绝', { swap, result })

  if (!currentRoomId.value) {
    console.error('[PlayerMode] 缺少房间信息')
    return
  }

  try {
    // 获取最新房间数据
    const roomData = await getRoomData(currentRoomId.value)
    if (!roomData) {
      console.error('[PlayerMode] 无法获取房间数据')
      return
    }

    // 添加拒绝日志到battleLogs
    if (!roomData.gameState.battleLogs) {
      roomData.gameState.battleLogs = []
    }
    roomData.gameState.battleLogs.push({
      message: result.message || `${swap.targetName}拒绝了${swap.initiatorName}的先声夺人请求`,
      timestamp: Date.now(),
      round: roomData.gameState.currentRound || 1,
      isPrivate: false
    })

    // 同步 pendingSwaps 到 Firebase
    if (!roomData.gameState.pendingSwaps) {
      roomData.gameState.pendingSwaps = []
    }
    // 关键修复：Pinia自动解包ref，直接使用gameStore.pendingSwaps
    roomData.gameState.pendingSwaps = gameStore.pendingSwaps

    // 保存到Firebase
    await saveRoomData(currentRoomId.value, roomData)
    debugLog('[PlayerMode] 拒绝结果已同步到Firebase')

    // 添加到本地日志
    gameStore.addLog(result.message || `${swap.targetName}拒绝了${swap.initiatorName}的先声夺人请求`)
  } catch (error) {
    console.error('[PlayerMode] 同步拒绝结果失败:', error)
    gameStore.addLog(`同步拒绝结果异常: ${error.message}`)
  }
}

/**
 * 确认城市部署
 */
async function handleDeploymentConfirmed({ cities, skill, skillData, activatedCitySkills }) {
  // 每次新部署重置战斗重试计数
  battleRetryCount.value = 0
  debugLog('[PlayerMode] 确认城市部署', { cities, skill, activatedCitySkills })
  debugLog('[PlayerMode] currentPlayer.name:', currentPlayer.value?.name)
  debugLog('[PlayerMode] currentPlayer.cities:')
  if (currentPlayer.value?.cities) {
    Object.entries(currentPlayer.value.cities).forEach(([cityName, city]) => {
      debugLog(`  ${cityName}: ${city.name} (HP: ${city.currentHp ?? city.hp})`)
    })
  }

  // 诊断日志：详细显示激活的城市技能
  debugLog('[PlayerMode] 激活的城市技能详情:')
  if (activatedCitySkills && Object.keys(activatedCitySkills).length > 0) {
    Object.keys(activatedCitySkills).forEach(cityName => {
      const skillData = activatedCitySkills[cityName]
      const actualCity = currentPlayer.value?.cities[cityName]
      debugLog(`  cityName=${cityName}: skillData.cityName="${skillData.cityName}", actualCity="${actualCity?.name}", 匹配=${skillData.cityName === actualCity?.name}`)
    })
  } else {
    debugLog('  (无激活的城市技能)')
  }

  // 保存到房间数据
  if (currentRoomId.value && currentPlayer.value) {
    const roomData = await getRoomData(currentRoomId.value)
    if (!roomData) {
      console.error('[PlayerMode] 无法获取房间数据')
      return
    }

    // 初始化游戏状态（如果还没有）
    if (!roomData.gameState) {
      debugLog('[PlayerMode] handleDeploymentConfirmed - 初始化gameState')

      // 构建playerStates
      const playerStates = {}
      roomData.players.forEach(player => {
        if (player && player.name) {
          playerStates[player.name] = {
            _initialized: true,  // 哨兵值：防止Firebase剥离空对象
            currentBattleCities: [],
            battleGoldSkill: null,
            battleGoldSkillData: null,
            deadCities: [],
            usedSkills: [],
            activatedCitySkills: null
          }
        }
      })

      roomData.gameState = {
        currentRound: 1,
        battleProcessed: false,
        battleLock: null,
        playerStates: Object.keys(playerStates).length > 0 ? playerStates : null,
        barrier: null,
        protections: null,
        ironCities: null,
        strengthBoost: null,
        morale: null,
        yqgzMarks: [],
        battleLogs: [],
        pendingSwaps: [],  // 先声夺人待处理请求数组
        drawRequests: []   // 求和请求数组
      }

      debugLog('[PlayerMode] handleDeploymentConfirmed - gameState初始化完成，playerStates keys:', Object.keys(playerStates))
    }

    // 确保 playerStates 存在（即使 gameState 已存在）
    if (!roomData.gameState.playerStates) {
      debugLog('[PlayerMode] handleDeploymentConfirmed - playerStates不存在，重新初始化')
      const playerStates = {}
      roomData.players.forEach(player => {
        if (player && player.name) {
          playerStates[player.name] = {
            _initialized: true,  // 哨兵值
            currentBattleCities: [],
            battleGoldSkill: null,
            battleGoldSkillData: null,
            deadCities: [],
            usedSkills: [],
            activatedCitySkills: null
          }
        }
      })
      roomData.gameState.playerStates = Object.keys(playerStates).length > 0 ? playerStates : null
      debugLog('[PlayerMode] handleDeploymentConfirmed - playerStates重新初始化完成，keys:', Object.keys(playerStates))
    }

    // 确保 playerStates 是对象而不是null
    if (!roomData.gameState.playerStates || typeof roomData.gameState.playerStates !== 'object') {
      debugLog('[PlayerMode] handleDeploymentConfirmed - playerStates为null或不是对象，重新初始化为空对象')
      roomData.gameState.playerStates = {}
    }

    // 初始化玩家状态（如果还没有）
    if (!roomData.gameState.playerStates[currentPlayer.value.name]) {
      debugLog('[PlayerMode] handleDeploymentConfirmed - 初始化当前玩家的playerState:', currentPlayer.value.name)
      roomData.gameState.playerStates[currentPlayer.value.name] = {
        _initialized: true,  // 哨兵值
        currentBattleCities: [],
        battleGoldSkill: null,
        battleGoldSkillData: null,
        deadCities: [],
        usedSkills: [],
        activatedCitySkills: null  // 用null代替{}
      }
    }

    const playerState = roomData.gameState.playerStates[currentPlayer.value.name]

    // 保存出战城市和技能
    playerState.currentBattleCities = cities.map(cityName => ({
      cityName,
      isStandGroundCity: skill === '按兵不动'
    }))
    playerState.battleGoldSkill = skill || null
    playerState.battleGoldSkillData = skillData || null  // 附加数据（目标城市等）
    playerState.activatedCitySkills = activatedCitySkills || null  // 用null代替{}

    // 保存出战城市HP快照，用于检测对手技能影响
    playerState.confirmedBattleCitiesHpSnapshot = {}
    cities.forEach(cityName => {
      const city = currentPlayer.value.cities[cityName]
      if (city) {
        playerState.confirmedBattleCitiesHpSnapshot[cityName] = {
          hp: city.currentHp !== undefined ? city.currentHp : city.hp,
          isAlive: city.isAlive !== false
        }
      }
    })

    // 关键修复：确保roomData.players中的cities对象和currentPlayer.cities一致
    const playerIdx = roomData.players.findIndex(p => p.name === currentPlayer.value.name)
    if (playerIdx !== -1) {
      debugLog('[PlayerMode] ===== 同步cities对象到roomData =====')
      debugLog('[PlayerMode] 同步前roomData.players[].cities:', Object.values(roomData.players[playerIdx].cities).map(c => c.name))
      debugLog('[PlayerMode] currentPlayer.cities:', Object.values(currentPlayer.value.cities).map(c => c.name))

      // 深度克隆currentPlayer的cities到roomData，确保一致
      roomData.players[playerIdx].cities = JSON.parse(JSON.stringify(currentPlayer.value.cities))

      debugLog('[PlayerMode] 同步后roomData.players[].cities:', Object.values(roomData.players[playerIdx].cities).map(c => c.name))
    }

    // 添加公开日志到roomData（所有玩家都能看到）
    if (!roomData.gameState.battleLogs) {
      roomData.gameState.battleLogs = []
    }
    roomData.gameState.battleLogs.push({
      message: `[回合${roomData.gameState.currentRound || 1}] ${currentPlayer.value.name} 已确认出战`,
      timestamp: Date.now(),
      round: roomData.gameState.currentRound || 1,
      isPrivate: false // 公开日志，所有人可见
    })

    // 关键修复：使用Firebase atomic multi-path update代替全量set
    // 防止两个玩家同时部署时互相覆盖对方的数据
    {
      const deployPlayerName = currentPlayer.value.name
      const deployPlayerIdx = roomData.players.findIndex(p => p.name === deployPlayerName)
      const deployRoomId = currentRoomId.value

      try {
        const { getDatabase, ref: dbRef, update } = await import('firebase/database')
        const db = getDatabase()

        // 构建multi-path update：只更新当前玩家相关的路径
        const updates = {}
        // 更新当前玩家的playerState（出战城市、技能等）
        updates[`rooms/${deployRoomId}/gameState/playerStates/${deployPlayerName}`] = roomData.gameState.playerStates[deployPlayerName]
        // 更新当前玩家的cities数据
        if (deployPlayerIdx !== -1) {
          updates[`rooms/${deployRoomId}/players/${deployPlayerIdx}/cities`] = roomData.players[deployPlayerIdx].cities
        }
        // 更新battleLogs
        updates[`rooms/${deployRoomId}/gameState/battleLogs`] = roomData.gameState.battleLogs
        // 更新lastActivity
        updates[`rooms/${deployRoomId}/lastActivity`] = Date.now()

        await update(dbRef(db), updates)
        debugLog('[PlayerMode] 部署数据已通过atomic multi-path update保存，避免覆盖其他玩家')
      } catch (updateError) {
        console.error('[PlayerMode] multi-path update失败，回退到全量保存:', updateError)
        await saveRoomData(currentRoomId.value, roomData)
      }
    }
    debugLog('[PlayerMode] 部署和日志已保存，等待其他玩家')

    // 关键修复：立即重新读取验证数据是否保存成功
    const verifyRoomData = await getRoomData(currentRoomId.value)
    if (verifyRoomData) {
      const verifyState = verifyRoomData.gameState.playerStates[currentPlayer.value.name]
      debugLog('[PlayerMode] ===== 验证保存结果 =====')
      debugLog('[PlayerMode] 验证当前玩家部署状态:', verifyState)
      debugLog('[PlayerMode] currentBattleCities长度:', verifyState?.currentBattleCities?.length || 0)
      debugLog('[PlayerMode] battleGoldSkill:', verifyState?.battleGoldSkill)
      debugLog('[PlayerMode] ========================================')

      // 检查所有玩家的部署状态
      debugLog('[PlayerMode] ===== 检查所有玩家部署状态 =====')
      verifyRoomData.players.forEach(player => {
        const state = verifyRoomData.gameState.playerStates[player.name]
        // 关键修复：确保currentBattleCities是数组（Firebase可能返回对象）
        const battleCities = Array.isArray(state?.currentBattleCities)
          ? state.currentBattleCities
          : (state?.currentBattleCities ? Object.values(state.currentBattleCities) : [])
        const deployed = state && (
          battleCities.length > 0 ||
          state.battleGoldSkill === '按兵不动'
        )
        debugLog(`[PlayerMode] ${player.name}: 已部署=${deployed}, currentBattleCities=${battleCities.length}`)
      })
      debugLog('[PlayerMode] ========================================')
    }

    // 注释：不在本地添加日志，统一通过Firebase监听器同步，避免重复

    // 检查是否有未确认的对手，添加私密日志
    const allPlayers = roomData.players.filter(p => p.name !== currentPlayer.value.name)
    const unconfirmedOpponents = allPlayers.filter(opponent => {
      const oppState = roomData.gameState.playerStates[opponent.name]
      // 关键修复：确保currentBattleCities是数组（Firebase可能返回对象）
      const battleCities = Array.isArray(oppState?.currentBattleCities)
        ? oppState.currentBattleCities
        : (oppState?.currentBattleCities ? Object.values(oppState.currentBattleCities) : [])
      const deployed = oppState && (
        battleCities.length > 0 ||
        oppState.battleGoldSkill === '按兵不动'
      )
      return !deployed
    })

    if (unconfirmedOpponents.length > 0) {
      const opponentNames = unconfirmedOpponents.map(p => p.name).join('、')
      gameStore.addPrivateLog(currentPlayer.value.name, `等待 ${opponentNames} 确认出战...`)
      debugLog('[PlayerMode] 还有未确认的对手:', opponentNames)
    } else {
      debugLog('[PlayerMode] 所有玩家都已确认出战！')
    }

    // 同步玩家数据到 gameStore
    syncRoomDataToGameStore(roomData)

    // 关键修复Bug2: 初始化initialCities（用于快速治疗等技能）
    debugLog('[PlayerMode] 初始化initialCities')
    gameStore.initialCities = {}
    roomData.players.forEach(player => {
      if (!player || !player.cities) return
      const citiesObj = {}
      Object.values(player.cities).forEach(city => {
        citiesObj[city.name] = {
          name: city.name,
          hp: city.hp || city.currentHp || city.baseHp,
          baseHp: city.baseHp || city.hp || city.currentHp,
          maxHp: city.maxHp || city.hp || city.baseHp
        }
      })
      gameStore.initialCities[player.name] = citiesObj
      debugLog(`[PlayerMode] 初始化${player.name}的initialCities:`, Object.keys(citiesObj).length, '座城市')
    })

    // 验证同步后的数据一致性
    debugLog('[PlayerMode] ===== 验证数据一致性 =====')
    const gameStorePlayer = gameStore.players.find(p => p.name === currentPlayer.value.name)
    if (gameStorePlayer) {
      debugLog('[PlayerMode] gameStore中的cities:', Object.values(gameStorePlayer.cities).map(c => c.name))
      debugLog('[PlayerMode] currentPlayer.cities:', Object.values(currentPlayer.value.cities).map(c => c.name))

      // 检查城市名称是否一致
      const gameStoreCityNames = Object.keys(gameStorePlayer.cities).sort()
      const currentPlayerCityNames = Object.keys(currentPlayer.value.cities).sort()

      let allMatch = gameStoreCityNames.length === currentPlayerCityNames.length &&
                     gameStoreCityNames.every((name, i) => name === currentPlayerCityNames[i])

      if (!allMatch) {
        console.error(`[PlayerMode] ⚠️ 城市列表不匹配:`)
        console.error(`  gameStore: ${gameStoreCityNames.join(', ')}`)
        console.error(`  currentPlayer: ${currentPlayerCityNames.join(', ')}`)
      } else {
        debugLog('[PlayerMode] ✅ 所有城市名称匹配正确')
      }
    }

    // 关键修复：选择性更新currentPlayer，不覆盖cities
    const updatedPlayerData = roomData.players.find(p => p.name === currentPlayer.value.name)
    if (updatedPlayerData && currentPlayer.value) {
      debugLog('[PlayerMode] handleDeploymentConfirmed - 选择性更新currentPlayer（保留cities）')

      // 只更新必要字段，保留本地的cities
      currentPlayer.value.gold = updatedPlayerData.gold
      currentPlayer.value.roster = updatedPlayerData.roster
      currentPlayer.value.centerCityName = updatedPlayerData.centerCityName
      currentPlayer.value.ready = updatedPlayerData.ready

      debugLog('[PlayerMode] handleDeploymentConfirmed - cities未被修改，仍为:', Object.values(currentPlayer.value.cities).map(c => c.name))
    }

    // 启动游戏
    currentStep.value = 'game'

    // 开始监听房间数据变化
    startRoomDataListener()
  }
}

/**
 * 同步房间数据到游戏 Store
 */
function syncRoomDataToGameStore(roomData) {
  if (!roomData) {
    console.warn('[PlayerMode] syncRoomDataToGameStore - roomData 为空')
    return
  }

  debugLog('[PlayerMode] 同步房间数据到 gameStore')

  // 设置游戏模式
  gameStore.gameMode = roomData.mode || '2P'

  // 不要清空 players，保留现有数据以保持 currentHp
  // gameStore.players.length = 0  <-- 移除此行

  if (!roomData.players || !Array.isArray(roomData.players)) {
    console.warn('[PlayerMode] syncRoomDataToGameStore - roomData.players 不是数组')
    return
  }

  // 关键修复：过滤无效和重复的玩家条目，防止ghost player
  const expectedPlayerCount = roomData.playerCount || (roomData.mode === '3P' ? 3 : 2)
  const seenNames = new Set()
  const validPlayers = roomData.players.filter(player => {
    // 跳过无名玩家
    if (!player || !player.name) {
      console.warn('[PlayerMode] syncRoomDataToGameStore - 跳过无名玩家:', player)
      return false
    }
    // 跳过重复玩家（取第一个出现的）
    if (seenNames.has(player.name)) {
      console.warn('[PlayerMode] syncRoomDataToGameStore - 跳过重复玩家:', player.name)
      return false
    }
    seenNames.add(player.name)
    return true
  }).slice(0, expectedPlayerCount) // 限制最大玩家数

  validPlayers.forEach(player => {
    if (!player.cities) {
      console.warn('[PlayerMode] syncRoomDataToGameStore - 玩家城市数据缺失', player)
      return
    }

    // 关键修复：支持对象结构的cities（城市名称迁移后）
    // player.cities可以是对象（新格式）或数组（旧格式）
    const citiesIsObject = typeof player.cities === 'object' && !Array.isArray(player.cities)
    if (!citiesIsObject && !Array.isArray(player.cities)) {
      console.warn('[PlayerMode] syncRoomDataToGameStore - cities既不是对象也不是数组', player)
      return
    }

    // 查找现有玩家数据（如果有）
    const existingPlayer = gameStore.players.find(p => p.name === player.name)

    // 确保每个城市都有正确的HP和存活状态
    // 关键修复：同步streaks数据（疲劳系统）
    // 注意：战斗处理期间不从Firebase覆盖streaks，防止onValue回调用旧数据覆盖
    // processBattle内部会自行管理streaks的正确性
    let streaks = {}
    if (isBattleProcessing.value && existingPlayer && existingPlayer.streaks) {
      // 战斗处理中：保留gameStore中的streaks（processBattle正在管理）
      streaks = { ...existingPlayer.streaks }
      debugLog(`[PlayerMode] syncRoomDataToGameStore - 战斗中，保留${player.name}的当前streaks:`, streaks)
    } else if (player.streaks && Object.keys(player.streaks).length > 0) {
      streaks = { ...player.streaks }
      debugLog(`[PlayerMode] syncRoomDataToGameStore - 从roomData加载${player.name}的streaks:`, streaks)
    } else if (existingPlayer && existingPlayer.streaks) {
      streaks = { ...existingPlayer.streaks }
      debugLog(`[PlayerMode] syncRoomDataToGameStore - 保留${player.name}的旧streaks:`, streaks)
    }

    // 关键修复：支持对象结构的cities
    // 将cities转换为对象格式（如果还不是的话）
    let citiesObj = {}
    if (citiesIsObject) {
      // 对象格式，但需要检查是否为数字键（Firebase可能将数组转为{0:..., 3:...}的稀疏对象）
      const keys = Object.keys(player.cities)
      const hasNumericKeys = keys.length > 0 && keys.every(k => !isNaN(k) && k !== '')
      if (hasNumericKeys) {
        // 数字键对象，转换为城市名称键
        Object.values(player.cities).forEach(city => {
          if (city && city.name) citiesObj[city.name] = city
        })
        debugLog(`[PlayerMode] syncRoomDataToGameStore - ${player.name}的cities有数字键，已转换为城市名称键，城市数量: ${Object.keys(citiesObj).length}`)
      } else {
        citiesObj = player.cities
        debugLog(`[PlayerMode] syncRoomDataToGameStore - ${player.name}的cities是对象格式，城市数量: ${Object.keys(citiesObj).length}`)
      }
    } else {
      // 数组格式，转换为对象格式（使用城市名称作为key）
      Object.values(player.cities).forEach(city => {
        if (city && city.name) citiesObj[city.name] = city
      })
      debugLog(`[PlayerMode] syncRoomDataToGameStore - ${player.name}的cities从数组转换为对象，城市数量: ${Object.keys(citiesObj).length}`)
    }

    // 确保每个城市都有正确的HP和存活状态
    const cities = {}
    Object.entries(citiesObj).forEach(([cityName, city]) => {
      // 优先使用roomData中的currentHp（战斗后已更新）
      let currentHp = city.currentHp !== undefined ? city.currentHp : city.hp
      let isAlive = city.isAlive !== undefined ? city.isAlive : (currentHp > 0)

      cities[cityName] = {
        ...city,
        currentHp: currentHp,
        isAlive: isAlive
      }
    })

    // 如果玩家已存在,更新数据;否则添加新玩家
    const playerIndex = gameStore.players.findIndex(p => p.name === player.name)
    const playerData = {
      name: player.name,
      gold: player.gold || 2,
      cities: cities,
      centerCityName: (() => {
        let ccn = player.centerCityName
        if (typeof ccn === 'number' || (typeof ccn === 'string' && !isNaN(ccn) && !cities[ccn])) {
          // Numeric centerCityName from old data - convert to city name
          const cityNames = Object.keys(cities)
          const numIdx = Number(ccn)
          ccn = cityNames[numIdx] || cityNames[0]
        }
        if (!ccn || !cities[ccn]) {
          ccn = Object.keys(cities)[0] || null
        }
        return ccn
      })(),
      roster: player.roster || [],
      battleModifiers: [],
      streaks: streaks // 关键修复Bug1: 添加streaks字段
    }

    if (playerIndex >= 0) {
      // 更新现有玩家
      gameStore.players[playerIndex] = playerData
      debugLog(`[PlayerMode] syncRoomDataToGameStore - 更新${player.name}的streaks:`, streaks)
    } else {
      // 添加新玩家
      gameStore.players.push(playerData)
      debugLog(`[PlayerMode] syncRoomDataToGameStore - 新增${player.name}的streaks:`, streaks)
    }
  })

  // 关键修复：清理gameStore中多余的ghost player（名字不在validPlayers中的）
  const validNames = new Set(validPlayers.map(p => p.name))
  for (let i = gameStore.players.length - 1; i >= 0; i--) {
    if (!validNames.has(gameStore.players[i].name)) {
      console.warn(`[PlayerMode] syncRoomDataToGameStore - 移除ghost player: ${gameStore.players[i].name || '(无名)'}`)
      gameStore.players.splice(i, 1)
    }
  }

  // 设置回合数和游戏状态
  if (roomData.gameState) {
    gameStore.currentRound = roomData.gameState.currentRound || 1

    // 关键修复：同步playerStates到gameStore，用于roster refill等状态检查
    if (roomData.gameState.playerStates) {
      gameStore.playerStates = roomData.gameState.playerStates
      debugLog('[PlayerMode] 已同步playerStates到gameStore')
    }

    // 关键修复：在syncRoomDataToGameStore中同步pendingSwaps
    // 这样可以确保在Vue响应性更新触发computed之前,pendingSwaps就已经同步了
    // 注意：Pinia自动解包ref,直接使用gameStore.pendingSwaps即可
    if (roomData.gameState.pendingSwaps && Array.isArray(roomData.gameState.pendingSwaps)) {
      gameStore.pendingSwaps = roomData.gameState.pendingSwaps
      debugLog(`[PlayerMode] syncRoomDataToGameStore中同步pendingSwaps: ${gameStore.pendingSwaps.length}条`)
    }

    // 同步drawRequests
    if (roomData.gameState.drawRequests && Array.isArray(roomData.gameState.drawRequests)) {
      // 检测是否有己方发起的求和请求被拒绝（在覆盖前对比）
      const myName = currentPlayer.value?.name
      if (myName) {
        const oldRequests = gameStore.drawRequests
        const newRequests = roomData.gameState.drawRequests
        for (const newReq of newRequests) {
          if (newReq.initiatorName === myName && newReq.status === 'rejected') {
            const oldReq = oldRequests.find(r => r.id === newReq.id)
            if (oldReq && oldReq.status === 'pending') {
              // 状态从pending变为rejected，弹窗通知
              showAlert('对手拒绝了你的和棋申请', { title: '求和被拒绝', icon: '❌' })
            }
          }
        }
      }
      gameStore.drawRequests = roomData.gameState.drawRequests
      debugLog(`[PlayerMode] syncRoomDataToGameStore中同步drawRequests: ${gameStore.drawRequests.length}条`)
    }

    // 关键修复：同步knownCities到gameStore
    // Firebase存储的是数组，gameStore需要Set
    if (roomData.gameState.knownCities) {
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步knownCities')
      Object.keys(roomData.gameState.knownCities).forEach(observer => {
        if (!gameStore.knownCities[observer]) {
          gameStore.knownCities[observer] = {}
        }
        Object.keys(roomData.gameState.knownCities[observer]).forEach(owner => {
          const cities = roomData.gameState.knownCities[observer][owner]
          gameStore.knownCities[observer][owner] = new Set(Array.isArray(cities) ? cities : [])
          debugLog(`[PlayerMode] 同步knownCities[${observer}][${owner}] = [${Array.from(gameStore.knownCities[observer][owner]).join(', ')}]`)
        })
      })
    }

    // 同步定海神针状态
    if (roomData.gameState.anchored) {
      Object.keys(gameStore.anchored).forEach(k => { delete gameStore.anchored[k] })
      Object.keys(roomData.gameState.anchored).forEach(playerName => {
        gameStore.anchored[playerName] = roomData.gameState.anchored[playerName]
      })
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步anchored:', JSON.stringify(gameStore.anchored))
    }

    // 同步代行省权状态
    if (roomData.gameState.actingCapital) {
      Object.keys(gameStore.actingCapital).forEach(k => delete gameStore.actingCapital[k])
      Object.assign(gameStore.actingCapital, JSON.parse(JSON.stringify(roomData.gameState.actingCapital)))
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步actingCapital:', JSON.stringify(gameStore.actingCapital))
    }

    // 同步守望相助状态（使用in-place更新保持reactive引用）
    if (roomData.gameState.mutualWatch) {
      Object.keys(gameStore.mutualWatch).forEach(k => delete gameStore.mutualWatch[k])
      Object.assign(gameStore.mutualWatch, JSON.parse(JSON.stringify(roomData.gameState.mutualWatch)))
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步mutualWatch:', JSON.stringify(gameStore.mutualWatch))
    } else {
      // Firebase中无mutualWatch时清空本地（防止残留数据）
      Object.keys(gameStore.mutualWatch).forEach(k => delete gameStore.mutualWatch[k])
    }

    // 同步生于紫室状态
    if (roomData.gameState.purpleChamber) {
      Object.keys(roomData.gameState.purpleChamber).forEach(playerName => {
        gameStore.purpleChamber[playerName] = roomData.gameState.purpleChamber[playerName]
      })
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步purpleChamber:', JSON.stringify(gameStore.purpleChamber))
    }

    // 同步副中心制状态
    if (roomData.gameState.subCenters) {
      Object.keys(roomData.gameState.subCenters).forEach(playerName => {
        gameStore.subCenters[playerName] = roomData.gameState.subCenters[playerName]
      })
    }

    // 同步天灾人祸状态
    if (roomData.gameState.disaster) {
      Object.keys(roomData.gameState.disaster).forEach(playerName => {
        if (!gameStore.disaster[playerName]) gameStore.disaster[playerName] = {}
        Object.assign(gameStore.disaster[playerName], roomData.gameState.disaster[playerName])
      })
    }

    // 同步厚积薄发状态
    if (roomData.gameState.hjbf) {
      Object.keys(roomData.gameState.hjbf).forEach(playerName => {
        if (!gameStore.hjbf[playerName]) gameStore.hjbf[playerName] = {}
        Object.assign(gameStore.hjbf[playerName], roomData.gameState.hjbf[playerName])
      })
    }

    // 同步电磁感应状态
    if (roomData.gameState.electromagnetic) {
      Object.keys(roomData.gameState.electromagnetic).forEach(targetName => {
        gameStore.electromagnetic[targetName] = roomData.gameState.electromagnetic[targetName]
      })
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步electromagnetic:', JSON.stringify(gameStore.electromagnetic))
    }

    // 同步屏障状态
    if (roomData.gameState.barrier) {
      Object.keys(roomData.gameState.barrier).forEach(playerName => {
        gameStore.barrier[playerName] = roomData.gameState.barrier[playerName]
      })
      debugLog('[PlayerMode] syncRoomDataToGameStore - 同步barrier:', JSON.stringify(gameStore.barrier))
    }

    // 同步bannedCities状态
    if (roomData.gameState.bannedCities) {
      Object.keys(roomData.gameState.bannedCities).forEach(playerName => {
        gameStore.bannedCities[playerName] = roomData.gameState.bannedCities[playerName]
      })
    }

    // 同步钢铁城市状态
    if (roomData.gameState.ironCities) {
      Object.keys(gameStore.ironCities).forEach(k => { delete gameStore.ironCities[k] })
      Object.keys(roomData.gameState.ironCities).forEach(playerName => {
        gameStore.ironCities[playerName] = roomData.gameState.ironCities[playerName]
      })
    }

    // 同步坚不可摧状态
    if (roomData.gameState.jianbukecui) {
      Object.keys(gameStore.jianbukecui).forEach(k => { delete gameStore.jianbukecui[k] })
      Object.keys(roomData.gameState.jianbukecui).forEach(playerName => {
        gameStore.jianbukecui[playerName] = roomData.gameState.jianbukecui[playerName]
      })
    }

    // 同步城市保护状态
    if (roomData.gameState.protections) {
      Object.keys(gameStore.protections).forEach(k => { delete gameStore.protections[k] })
      Object.keys(roomData.gameState.protections).forEach(playerName => {
        gameStore.protections[playerName] = roomData.gameState.protections[playerName]
      })
    }

    // 同步拔旗易帜标记
    if (roomData.gameState.changeFlagMark) {
      Object.keys(gameStore.changeFlagMark).forEach(k => { delete gameStore.changeFlagMark[k] })
      Object.keys(roomData.gameState.changeFlagMark).forEach(playerName => {
        gameStore.changeFlagMark[playerName] = roomData.gameState.changeFlagMark[playerName]
      })
    }

    // 同步技能使用次数
    if (roomData.gameState.skillUsageTracking) {
      Object.keys(gameStore.skillUsageTracking).forEach(k => { delete gameStore.skillUsageTracking[k] })
      Object.keys(roomData.gameState.skillUsageTracking).forEach(playerName => {
        gameStore.skillUsageTracking[playerName] = roomData.gameState.skillUsageTracking[playerName]
      })
    }

    // 同步单回合技能花费
    if (roomData.gameState.roundGoldSpent) {
      Object.keys(gameStore.roundGoldSpent).forEach(k => { delete gameStore.roundGoldSpent[k] })
      Object.keys(roomData.gameState.roundGoldSpent).forEach(playerName => {
        gameStore.roundGoldSpent[playerName] = roomData.gameState.roundGoldSpent[playerName]
      })
    }

    // 同步伪装城市状态
    if (roomData.gameState.disguisedCities) {
      Object.keys(gameStore.disguisedCities).forEach(k => { delete gameStore.disguisedCities[k] })
      Object.keys(roomData.gameState.disguisedCities).forEach(playerName => {
        gameStore.disguisedCities[playerName] = roomData.gameState.disguisedCities[playerName]
      })
    }

    // 同步谨慎交换集合（步步高升）
    if (roomData.gameState.cautiousExchange) {
      Object.keys(gameStore.cautiousExchange).forEach(k => { delete gameStore.cautiousExchange[k] })
      Object.keys(roomData.gameState.cautiousExchange).forEach(playerName => {
        const cities = roomData.gameState.cautiousExchange[playerName]
        gameStore.cautiousExchange[playerName] = new Set(Array.isArray(cities) ? cities : [])
      })
    }

    // 同步谨慎交换集合（技能效果）
    if (roomData.gameState.cautionSet) {
      Object.keys(gameStore.cautionSet).forEach(k => { delete gameStore.cautionSet[k] })
      Object.keys(roomData.gameState.cautionSet).forEach(playerName => {
        const cities = roomData.gameState.cautionSet[playerName]
        gameStore.cautionSet[playerName] = new Set(Array.isArray(cities) ? cities : [])
      })
    }

    // 同步技能冷却状态
    Object.keys(gameStore.cooldowns).forEach(k => { delete gameStore.cooldowns[k] })
    if (roomData.gameState.cooldowns) {
      Object.keys(roomData.gameState.cooldowns).forEach(playerName => {
        gameStore.cooldowns[playerName] = roomData.gameState.cooldowns[playerName]
      })
    }
    debugLog('[PlayerMode] syncRoomDataToGameStore - 同步cooldowns:', JSON.stringify(gameStore.cooldowns))

    // 同步不露踪迹状态
    if (roomData.gameState.stealth) {
      Object.keys(gameStore.stealth).forEach(k => { delete gameStore.stealth[k] })
      Object.keys(roomData.gameState.stealth).forEach(playerName => {
        gameStore.stealth[playerName] = roomData.gameState.stealth[playerName]
      })
    }

    // 同步寸步难行状态
    if (roomData.gameState.stareDown) {
      Object.keys(gameStore.stareDown).forEach(k => { delete gameStore.stareDown[k] })
      Object.keys(roomData.gameState.stareDown).forEach(playerName => {
        gameStore.stareDown[playerName] = roomData.gameState.stareDown[playerName]
      })
    }

    // 同步移花接木偷取技能状态
    if (roomData.gameState.stolenSkills) {
      Object.keys(gameStore.stolenSkills).forEach(k => { delete gameStore.stolenSkills[k] })
      Object.keys(roomData.gameState.stolenSkills).forEach(playerName => {
        gameStore.stolenSkills[playerName] = roomData.gameState.stolenSkills[playerName]
      })
    }

    // 同步定时爆破状态
    if (roomData.gameState.timeBombs) {
      Object.keys(gameStore.timeBombs).forEach(k => { delete gameStore.timeBombs[k] })
      Object.keys(roomData.gameState.timeBombs).forEach(playerName => {
        gameStore.timeBombs[playerName] = roomData.gameState.timeBombs[playerName]
      })
    }

    // 同步海市蜃楼状态
    if (roomData.gameState.centerProjection) {
      Object.keys(gameStore.centerProjection).forEach(k => { delete gameStore.centerProjection[k] })
      Object.keys(roomData.gameState.centerProjection).forEach(playerName => {
        gameStore.centerProjection[playerName] = roomData.gameState.centerProjection[playerName]
      })
    }

    // 同步金融危机状态
    if (roomData.gameState.financialCrisis) {
      gameStore.financialCrisis = roomData.gameState.financialCrisis
    }

    // 同步无懈可击拦截状态
    debugLog('[PlayerMode] syncRoomDataToGameStore - pendingIntercept检查:', {
      hasKey: 'pendingIntercept' in (roomData.gameState || {}),
      value: roomData.gameState.pendingIntercept,
      currentLocal: gameStore.pendingIntercept
    })
    if (roomData.gameState.pendingIntercept !== undefined && roomData.gameState.pendingIntercept !== null) {
      const oldIntercept = gameStore.pendingIntercept
      const newIntercept = roomData.gameState.pendingIntercept

      gameStore.pendingIntercept = newIntercept
      debugLog('[PlayerMode] syncRoomDataToGameStore - 已同步pendingIntercept:', newIntercept?.status, '目标:', newIntercept?.targetName)

      // Player A检测状态变化
      if (oldIntercept && newIntercept && oldIntercept.status === 'pending' && newIntercept.status !== 'pending') {
        if (newIntercept.casterName === currentPlayer.value?.name) {
          if (newIntercept.status === 'accepted' || newIntercept.status === 'expired') {
            debugLog('[PlayerMode] pendingIntercept状态变为accepted/expired，执行技能')
            executePendingSkill(newIntercept)
          } else if (newIntercept.status === 'countered') {
            debugLog('[PlayerMode] pendingIntercept状态变为countered，技能被拦截')
            handleSkillCountered(newIntercept)
          }
        }
      }
    } else {
      // 如果Firebase中没有pendingIntercept（已清除），也同步清除本地
      if (gameStore.pendingIntercept) {
        debugLog('[PlayerMode] syncRoomDataToGameStore - 清除本地pendingIntercept')
        gameStore.pendingIntercept = null
      }
    }
  }

  // 同步时来运转/人质交换弹窗状态
  if (roomData.gameState && 'pendingFortuneSwap' in roomData.gameState) {
    if (roomData.gameState.pendingFortuneSwap !== undefined && roomData.gameState.pendingFortuneSwap !== null) {
      const oldSwap = gameStore.pendingFortuneSwap
      const newSwap = roomData.gameState.pendingFortuneSwap

      gameStore.pendingFortuneSwap = newSwap
      debugLog('[PlayerMode] syncRoomDataToGameStore - 已同步pendingFortuneSwap:', newSwap?.status, '目标:', newSwap?.targetName)

      // Player A检测状态变化
      if (oldSwap && newSwap && oldSwap.status === 'pending' && newSwap.status !== 'pending') {
        if (newSwap.casterName === currentPlayer.value?.name) {
          debugLog('[PlayerMode] pendingFortuneSwap状态变为:', newSwap.status)
          executeFortuneSwapResult(newSwap)
        }
      }
    } else {
      if (gameStore.pendingFortuneSwap) {
        debugLog('[PlayerMode] syncRoomDataToGameStore - 清除本地pendingFortuneSwap')
        gameStore.pendingFortuneSwap = null
        waitingForFortuneSwap.value = false
      }
    }
  }

  debugLog('[PlayerMode] gameStore已更新，玩家数量:', gameStore.players.length)
}

/**
 * 开始监听房间数据
 */
function startRoomDataListener() {
  if (!currentRoomId.value) return

  // 防止重复启动监听器
  if (roomDataListener) {
    debugLog('[PlayerMode] 监听器已经在运行，跳过重复启动')
    return
  }

  debugLog('[PlayerMode] 开始监听房间数据变化')

  roomDataListener = startRoomListener(currentRoomId.value, async (data) => {
    debugLog('[PlayerMode] ===== 监听器被触发 =====', new Date().toLocaleTimeString())
    debugLog('[PlayerMode] 触发前本地pendingSwaps:', gameStore.pendingSwaps?.length || 0, '条')
    debugLog('[PlayerMode] 房间数据更新', data)
    debugLog('[PlayerMode] 监听器收到的data keys:', Object.keys(data || {}))
    debugLog('[PlayerMode] 监听器收到的gameState:', data.gameState)
    debugLog('[PlayerMode] 监听器收到的gameState keys:', data.gameState ? Object.keys(data.gameState) : 'undefined')
    debugLog('[PlayerMode] 监听器收到的pendingSwaps:', data.gameState?.pendingSwaps)
    debugLog('[PlayerMode] 监听器收到的pendingSwaps长度:', data.gameState?.pendingSwaps?.length || 0)

    // 关键修复：规范化Firebase返回的players.cities数据
    // Firebase可能将城市名称键的对象转为数组或数字键对象
    if (data.players && Array.isArray(data.players)) {
      data.players.forEach(p => normalizePlayerCities(p))
    }

    // 同步数据到 gameStore
    syncRoomDataToGameStore(data)

    // 关键修复：在监听器顶层检查游戏是否结束
    // 确保第二个玩家（非战斗处理方）也能看到胜利/失败画面
    if (data.gameState?.gameOver && !showVictory.value) {
      debugLog('[PlayerMode] 监听器顶层检测到游戏结束，获胜者:', data.gameState.winner)
      // 同步最终的城市数据到currentPlayer（确保结算画面显示正确HP）
      const finalPlayerData = data.players?.find(p => p.name === currentPlayer.value?.name)
      if (finalPlayerData) {
        currentPlayer.value = JSON.parse(JSON.stringify(finalPlayerData))
      }
      // 设置winner到gameLogic（如果尚未设置）
      if (gameLogic && !gameLogic.isGameOver?.value) {
        const winnerName = data.gameState.winner
        if (winnerName && winnerName !== '平局') {
          const winnerPlayer = data.players?.find(p => p.name === winnerName)
          gameLogic.winner.value = winnerPlayer ? JSON.parse(JSON.stringify(winnerPlayer)) : null
        } else {
          gameLogic.winner.value = null  // null = draw
        }
        gameLogic.isGameOver.value = true
      }
      showVictory.value = true
      stopAllOnGameOver()
      return
    }

    // 游戏已结束，不再处理后续更新
    if (showVictory.value) return

    // 关键修复：选择性更新currentPlayer，不覆盖cities（防止数据被错误同步）
    const updatedPlayerData = data.players.find(p => p.name === currentPlayer.value?.name)
    if (updatedPlayerData && currentPlayer.value) {
      debugLog('[PlayerMode] ===== BUG 6 诊断: 监听器更新 =====')
      debugLog('[PlayerMode] 监听器 - 选择性更新currentPlayer（保留cities）')

      // 诊断：显示更新前的状态
      debugLog('[PlayerMode] 更新前本地centerCityName:', currentPlayer.value.centerCityName)
      debugLog('[PlayerMode] 更新前本地cities:')
      if (currentPlayer.value.cities) {
        Object.entries(currentPlayer.value.cities).forEach(([cityName, city]) => {
          debugLog(`  ${cityName}: ${city.name}`)
        })
      }
      if (currentPlayer.value.centerCityName !== null && currentPlayer.value.centerCityName !== undefined) {
        debugLog('[PlayerMode] 更新前本地centerCityName指向的城市:', currentPlayer.value.cities[currentPlayer.value.centerCityName]?.name)
      }

      // 诊断：显示Firebase传来的数据
      debugLog('[PlayerMode] Firebase传来的centerCityName:', updatedPlayerData.centerCityName)
      debugLog('[PlayerMode] Firebase传来的cities:')
      if (updatedPlayerData.cities) {
        Object.entries(updatedPlayerData.cities).forEach(([cityName, city]) => {
          debugLog(`  ${cityName}: ${city.name}`)
        })
      }
      if (updatedPlayerData.centerCityName !== null && updatedPlayerData.centerCityName !== undefined) {
        debugLog('[PlayerMode] Firebase centerCityName指向的城市:', updatedPlayerData.cities[updatedPlayerData.centerCityName]?.name)
      }

      // 只更新这些字段，保留本地的cities数组不变
      currentPlayer.value.gold = updatedPlayerData.gold
      currentPlayer.value.roster = updatedPlayerData.roster
      currentPlayer.value.centerCityName = updatedPlayerData.centerCityName
      currentPlayer.value.ready = updatedPlayerData.ready

      // 诊断：显示更新后的状态
      debugLog('[PlayerMode] 更新后本地centerCityName:', currentPlayer.value.centerCityName)
      if (currentPlayer.value.centerCityName !== null && currentPlayer.value.centerCityName !== undefined) {
        debugLog('[PlayerMode] 更新后本地centerCityName指向的城市:', currentPlayer.value.cities[currentPlayer.value.centerCityName]?.name)
        debugLog('[PlayerMode] ⚠️ 如果这个城市名称与Firebase centerCityName指向的城市不同，说明数据不一致！')
      }
      debugLog('[PlayerMode] ==========================================')

      // 只在特定情况下更新cities（如重新抽取、战斗后HP变化、城市交换）
      if (updatedPlayerData.cities) {
        const updatedCityNames = new Set(Object.keys(updatedPlayerData.cities))
        const currentCityNames = new Set(Object.keys(currentPlayer.value.cities))

        // 检查城市数量变化
        const sizeChanged = updatedCityNames.size !== currentCityNames.size
        // 使用Set比较检查是否有城市名称变化（真正的交换）
        // 计算差异数量：当前有但更新没有的城市数
        const removedCities = [...currentCityNames].filter(name => !updatedCityNames.has(name))
        const addedCities = [...updatedCityNames].filter(name => !currentCityNames.has(name))
        const hasCitySwap = !sizeChanged && removedCities.length > 0

        if (sizeChanged) {
          debugLog('[PlayerMode] 监听器 - cities数量变化，更新cities')
          currentPlayer.value.cities = JSON.parse(JSON.stringify(updatedPlayerData.cities))
        } else if (hasCitySwap) {
          // 安全检查：真正的交换通常只涉及1-2座城市
          // 如果超过一半的城市都不同，很可能是数据同步错误，忽略
          if (removedCities.length > currentCityNames.size / 2) {
            console.warn(`[PlayerMode] 监听器 - 检测到大量城市变化(${removedCities.length}/${currentCityNames.size})，可能是数据同步错误，忽略`)
            console.warn(`  本地: ${[...currentCityNames].join(', ')}`)
            console.warn(`  Firebase: ${[...updatedCityNames].join(', ')}`)
          } else {
            // 真正的城市交换（1-2座城市不同）
            debugLog(`[PlayerMode] 监听器 - 检测到城市交换(${removedCities.length}座)，更新cities`)
            debugLog(`  移除: ${removedCities.join(', ')}`)
            debugLog(`  新增: ${addedCities.join(', ')}`)
            currentPlayer.value.cities = JSON.parse(JSON.stringify(updatedPlayerData.cities))
          }
        } else {
          // 没有交换，只更新HP和存活状态，不改变城市列表
          Object.entries(updatedPlayerData.cities).forEach(([cityName, updatedCity]) => {
            if (currentPlayer.value.cities[cityName]) {
              const localCity = currentPlayer.value.cities[cityName]
              // 只更新HP相关字段
              if (updatedCity.currentHp !== undefined) {
                localCity.currentHp = updatedCity.currentHp
              }
              if (updatedCity.isAlive !== undefined) {
                localCity.isAlive = updatedCity.isAlive
              }
              // 同步isInHealing状态
              if (updatedCity.isInHealing !== undefined) {
                localCity.isInHealing = updatedCity.isInHealing
              }
            }
          })
        }
      }
    }

    // 检查已确认出战城市是否被对手技能影响
    if (currentStep.value === 'game' && data.gameState?.playerStates) {
      const myState = data.gameState.playerStates[currentPlayer.value.name]
      const snapshot = myState?.confirmedBattleCitiesHpSnapshot
      const battleCities = Array.isArray(myState?.currentBattleCities)
        ? myState.currentBattleCities
        : (myState?.currentBattleCities ? Object.values(myState.currentBattleCities) : [])

      if (snapshot && Object.keys(snapshot).length > 0 && battleCities.length > 0) {
        let affected = false
        let reason = ''

        for (const entry of battleCities) {
          const cityName = entry.cityName || entry
          const snap = snapshot[cityName]
          if (!snap) continue

          // 检查城市是否被抢夺（不再属于己方）
          const myPlayerData = data.players.find(p => p.name === currentPlayer.value.name)
          if (!myPlayerData?.cities?.[cityName]) {
            affected = true
            reason = `${cityName} 被对手抢夺`
            break
          }

          const currentCity = myPlayerData.cities[cityName]
          const currentHp = currentCity.currentHp !== undefined ? currentCity.currentHp : currentCity.hp
          const snapshotHp = snap.hp

          // 检查城市是否阵亡
          if (currentCity.isAlive === false || currentHp <= 0) {
            affected = true
            reason = `${cityName} 已阵亡`
            break
          }

          // 检查HP是否变化
          if (currentHp !== snapshotHp) {
            affected = true
            reason = `${cityName} HP变化 (${snapshotHp} → ${currentHp})`
            break
          }
        }

        if (affected) {
          debugLog(`[PlayerMode] 出战城市受影响: ${reason}，退回部署界面`)
          gameStore.addLog(`⚠️ 你的出战城市受到影响(${reason})，请重新选择出战城市`)

          // 清除当前部署状态（Firebase）
          try {
            const { getDatabase, ref: dbRef, update } = await import('firebase/database')
            const db = getDatabase()
            const updates = {}
            updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/currentBattleCities`] = []
            updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/battleGoldSkill`] = null
            updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/battleGoldSkillData`] = null
            updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/activatedCitySkills`] = null
            updates[`rooms/${currentRoomId.value}/gameState/playerStates/${currentPlayer.value.name}/confirmedBattleCitiesHpSnapshot`] = null
            await update(dbRef(db), updates)
            debugLog('[PlayerMode] 已清除Firebase部署状态')
          } catch (e) {
            console.error('[PlayerMode] 清除部署状态失败:', e)
          }

          // 退回部署界面
          currentStep.value = 'city-deployment'
          return  // 不再处理后续逻辑
        }
      }
    }

    // 更新游戏状态到store
    if (data.gameState) {
      gameStore.currentRound = data.gameState.currentRound || 1

      // 同步战斗日志到本地（累积追加，不清空历史日志）
      if (data.gameState.battleLogs && Array.isArray(data.gameState.battleLogs)) {
        // 获取当前已有的日志时间戳，用于去重
        const existingTimestamps = new Set(gameStore.logs.map(log => log.timestamp))

        // 只追加新日志，避免重复
        // Also skip logs that were created before the user cleared their local logs
        const clearedAt = gameStore.logsClearedAt
        const newLogs = data.gameState.battleLogs.filter(log => {
          if (existingTimestamps.has(log.timestamp)) return false
          if (clearedAt && log.timestamp <= clearedAt) return false
          return true
        })

        // 过滤私密日志：只显示公开日志或对当前玩家可见的私密日志
        const visibleLogs = newLogs.filter(log => {
          // 公开日志
          if (!log.isPrivate) return true
          // 私密日志且当前玩家在可见列表中
          if (log.isPrivate && log.visibleTo && log.visibleTo.includes(currentPlayer.value.name)) return true
          return false
        })

        visibleLogs.forEach(log => {
          gameStore.logs.push(log)
        })
        if (visibleLogs.length > 0) {
          debugLog(`[PlayerMode] 已追加${visibleLogs.length}条新日志（共${gameStore.logs.length}条）`)
        }
      }

      // 同步已知城市到gameStore（全量替换，确保clearCityKnownStatus的删除操作能正确同步）
      debugLog('[PlayerMode] ===== 监听器同步knownCities =====')
      debugLog('[PlayerMode] data.gameState.knownCities:', JSON.stringify(data.gameState.knownCities, null, 2))

      // 先清除本地knownCities，再从Firebase重建，确保删除操作能正确同步
      Object.keys(gameStore.knownCities).forEach(key => delete gameStore.knownCities[key])

      if (data.gameState.knownCities) {
        // 构建玩家名称→城市列表映射，用于将数字索引转回城市名称
        const playerCitiesMap = {}
        if (data.players && Array.isArray(data.players)) {
          data.players.forEach(p => {
            if (p && p.name && p.cities) {
              playerCitiesMap['p_' + p.name] = Object.keys(p.cities)
            }
          })
        }

        Object.keys(data.gameState.knownCities).forEach(observer => {
          gameStore.knownCities[observer] = {}
          Object.keys(data.gameState.knownCities[observer]).forEach(owner => {
            const rawCities = data.gameState.knownCities[observer][owner]
            // 修复：将数字索引值转换为城市名称
            const ownerCityNames = playerCitiesMap[owner] || []
            const normalizedCities = (Array.isArray(rawCities) ? rawCities : []).map(val => {
              if (typeof val === 'string' && !isNaN(val) && val !== '' && ownerCityNames[Number(val)]) {
                const converted = ownerCityNames[Number(val)]
                debugLog(`[PlayerMode] knownCities修复: "${val}" → "${converted}"`)
                return converted
              }
              return val
            })
            gameStore.knownCities[observer][owner] = new Set(normalizedCities)
            debugLog(`[PlayerMode] 监听器同步: knownCities[${observer}][${owner}] = [${normalizedCities.join(', ')}]`)
          })
        })
      }
      debugLog('[PlayerMode] 监听器gameStore.knownCities同步完成:', JSON.stringify(gameStore.knownCities, null, 2))
      debugLog('[PlayerMode] ==========================================')

      // 同步定海神针状态
      if (data.gameState.anchored) {
        Object.keys(gameStore.anchored).forEach(k => { delete gameStore.anchored[k] })
        Object.keys(data.gameState.anchored).forEach(playerName => {
          gameStore.anchored[playerName] = data.gameState.anchored[playerName]
        })
      }

      // 同步钢铁城市状态
      if (data.gameState.ironCities) {
        Object.keys(gameStore.ironCities).forEach(k => { delete gameStore.ironCities[k] })
        Object.keys(data.gameState.ironCities).forEach(playerName => {
          gameStore.ironCities[playerName] = data.gameState.ironCities[playerName]
        })
      }

      // 同步坚不可摧状态
      if (data.gameState.jianbukecui) {
        Object.keys(gameStore.jianbukecui).forEach(k => { delete gameStore.jianbukecui[k] })
        Object.keys(data.gameState.jianbukecui).forEach(playerName => {
          gameStore.jianbukecui[playerName] = data.gameState.jianbukecui[playerName]
        })
      }

      // 同步城市保护状态
      if (data.gameState.protections) {
        Object.keys(gameStore.protections).forEach(k => { delete gameStore.protections[k] })
        Object.keys(data.gameState.protections).forEach(playerName => {
          gameStore.protections[playerName] = data.gameState.protections[playerName]
        })
      }

      // 同步拔旗易帜标记
      if (data.gameState.changeFlagMark) {
        Object.keys(gameStore.changeFlagMark).forEach(k => { delete gameStore.changeFlagMark[k] })
        Object.keys(data.gameState.changeFlagMark).forEach(playerName => {
          gameStore.changeFlagMark[playerName] = data.gameState.changeFlagMark[playerName]
        })
      }

      // 同步技能使用次数
      if (data.gameState.skillUsageTracking) {
        Object.keys(gameStore.skillUsageTracking).forEach(k => { delete gameStore.skillUsageTracking[k] })
        Object.keys(data.gameState.skillUsageTracking).forEach(playerName => {
          gameStore.skillUsageTracking[playerName] = data.gameState.skillUsageTracking[playerName]
        })
      }

      // 同步伪装城市状态
      Object.keys(gameStore.disguisedCities).forEach(k => { delete gameStore.disguisedCities[k] })
      if (data.gameState.disguisedCities) {
        Object.keys(data.gameState.disguisedCities).forEach(playerName => {
          gameStore.disguisedCities[playerName] = data.gameState.disguisedCities[playerName]
        })
      }

      // 同步谨慎交换集合（步步高升）
      Object.keys(gameStore.cautiousExchange).forEach(k => { delete gameStore.cautiousExchange[k] })
      if (data.gameState.cautiousExchange) {
        Object.keys(data.gameState.cautiousExchange).forEach(playerName => {
          const cities = data.gameState.cautiousExchange[playerName]
          gameStore.cautiousExchange[playerName] = new Set(Array.isArray(cities) ? cities : [])
        })
      }

      // 同步谨慎交换集合（技能效果）
      Object.keys(gameStore.cautionSet).forEach(k => { delete gameStore.cautionSet[k] })
      if (data.gameState.cautionSet) {
        Object.keys(data.gameState.cautionSet).forEach(playerName => {
          const cities = data.gameState.cautionSet[playerName]
          gameStore.cautionSet[playerName] = new Set(Array.isArray(cities) ? cities : [])
        })
      }

      // 同步禁用技能状态（事半功倍/解除封锁）
      // 必须先清空再写入，否则解除封锁后本地残留旧禁用
      // 注意：必须用in-place mutation保持reactive引用，不能替换整个对象
      Object.keys(gameStore.bannedSkills).forEach(k => { delete gameStore.bannedSkills[k] })
      if (data.gameState.bannedSkills) {
        Object.keys(data.gameState.bannedSkills).forEach(playerName => {
          if (data.gameState.bannedSkills[playerName] && typeof data.gameState.bannedSkills[playerName] === 'object' && Object.keys(data.gameState.bannedSkills[playerName]).length > 0) {
            gameStore.bannedSkills[playerName] = data.gameState.bannedSkills[playerName]
          }
        })
      }
      debugLog('[PlayerMode] 已同步bannedSkills:', JSON.stringify(gameStore.bannedSkills))

      // 同步技能保护状态
      Object.keys(gameStore.skillProtection).forEach(k => { delete gameStore.skillProtection[k] })
      if (data.gameState.skillProtection) {
        Object.keys(data.gameState.skillProtection).forEach(playerName => {
          gameStore.skillProtection[playerName] = data.gameState.skillProtection[playerName]
        })
      }
      debugLog('[PlayerMode] 已同步skillProtection:', JSON.stringify(gameStore.skillProtection))

      // 同步技能冷却状态
      Object.keys(gameStore.cooldowns).forEach(k => { delete gameStore.cooldowns[k] })
      if (data.gameState.cooldowns) {
        Object.keys(data.gameState.cooldowns).forEach(playerName => {
          gameStore.cooldowns[playerName] = data.gameState.cooldowns[playerName]
        })
      }
      debugLog('[PlayerMode] 已同步cooldowns:', JSON.stringify(gameStore.cooldowns))

      // 同步无懈可击拦截状态（实时监听器）
      debugLog('[PlayerMode] [listener] pendingIntercept检查:', {
        hasKey: 'pendingIntercept' in (data.gameState || {}),
        value: data.gameState.pendingIntercept,
        currentLocal: gameStore.pendingIntercept?.status
      })
      if (data.gameState.pendingIntercept !== undefined && data.gameState.pendingIntercept !== null) {
        const oldIntercept = gameStore.pendingIntercept
        const newIntercept = data.gameState.pendingIntercept

        gameStore.pendingIntercept = newIntercept
        debugLog('[PlayerMode] [listener] 已同步pendingIntercept:', newIntercept?.status, '目标:', newIntercept?.targetName)

        // Player A检测状态变化
        if (oldIntercept && newIntercept && oldIntercept.status === 'pending' && newIntercept.status !== 'pending') {
          if (newIntercept.casterName === currentPlayer.value?.name) {
            if (newIntercept.status === 'accepted' || newIntercept.status === 'expired') {
              debugLog('[PlayerMode] [listener] pendingIntercept → accepted/expired，执行技能')
              executePendingSkill(newIntercept)
            } else if (newIntercept.status === 'countered') {
              debugLog('[PlayerMode] [listener] pendingIntercept → countered，技能被拦截')
              handleSkillCountered(newIntercept)
            }
          }
        }
      } else {
        if (gameStore.pendingIntercept) {
          debugLog('[PlayerMode] [listener] 清除本地pendingIntercept')
          gameStore.pendingIntercept = null
        }
      }

      // 同步时来运转/人质交换弹窗状态
      if (data.gameState.pendingFortuneSwap !== undefined && data.gameState.pendingFortuneSwap !== null) {
        const oldSwap = gameStore.pendingFortuneSwap
        const newSwap = data.gameState.pendingFortuneSwap

        gameStore.pendingFortuneSwap = newSwap
        debugLog('[PlayerMode] [listener] 已同步pendingFortuneSwap:', newSwap?.status, '目标:', newSwap?.targetName)

        // Player A检测状态变化
        if (oldSwap && newSwap && oldSwap.status === 'pending' && newSwap.status !== 'pending') {
          if (newSwap.casterName === currentPlayer.value?.name) {
            debugLog('[PlayerMode] [listener] pendingFortuneSwap状态变为:', newSwap.status)
            executeFortuneSwapResult(newSwap)
          }
        }
      } else {
        if (gameStore.pendingFortuneSwap) {
          debugLog('[PlayerMode] [listener] 清除本地pendingFortuneSwap')
          gameStore.pendingFortuneSwap = null
          waitingForFortuneSwap.value = false
        }
      }

      // 同步金币贷款状态
      Object.keys(gameStore.goldLoanRounds).forEach(k => { delete gameStore.goldLoanRounds[k] })
      if (data.gameState.goldLoanRounds) {
        Object.keys(data.gameState.goldLoanRounds).forEach(playerName => {
          gameStore.goldLoanRounds[playerName] = data.gameState.goldLoanRounds[playerName]
        })
      }

      // 同步代行省权状态
      Object.keys(gameStore.actingCapital).forEach(k => delete gameStore.actingCapital[k])
      if (data.gameState.actingCapital) {
        Object.assign(gameStore.actingCapital, JSON.parse(JSON.stringify(data.gameState.actingCapital)))
      }
      debugLog('[PlayerMode] 已同步actingCapital:', JSON.stringify(gameStore.actingCapital))

      // 同步守望相助状态（使用in-place更新保持reactive引用）
      Object.keys(gameStore.mutualWatch).forEach(k => delete gameStore.mutualWatch[k])
      if (data.gameState.mutualWatch) {
        Object.assign(gameStore.mutualWatch, JSON.parse(JSON.stringify(data.gameState.mutualWatch)))
      }
      debugLog('[PlayerMode] 已同步mutualWatch:', JSON.stringify(gameStore.mutualWatch))

      // 验证pendingSwaps同步状态（已在syncRoomDataToGameStore中同步）
      debugLog('[PlayerMode] 验证pendingSwaps同步状态:', {
        firebaseHas: !!data.gameState?.pendingSwaps,
        firebaseLength: data.gameState?.pendingSwaps?.length || 0,
        localLength: gameStore.pendingSwaps?.length || 0,
        localData: gameStore.pendingSwaps
      })

      // 最终状态验证
      debugLog('[PlayerMode] 监听器处理完毕，最终本地pendingSwaps:', gameStore.pendingSwaps?.length || 0, '条')
      debugLog('[PlayerMode] =================================')

      // 检查是否需要选择新的中心城市（强制转移等技能触发）
      if (currentPlayer.value && data.gameState.playerStates) {
        const myState = data.gameState.playerStates[currentPlayer.value.name]
        if (myState?.needsNewCenter && !showNewCenterSelection.value) {
          debugLog('[PlayerMode] 检测到需要选择新中心城市:', myState.newCenterReason)
          newCenterReason.value = myState.newCenterReason || '未知技能'
          newCenterSelected.value = ''
          showNewCenterSelection.value = true
        }
      }

      // 检查是否所有玩家都完成了中心城市选择
      if (currentStep.value === 'waiting-for-center-confirmation') {
        const allPlayersReady = data.players.every(p => p.ready === true)

        debugLog('[PlayerMode] 监听器检测到等待中心城市确认状态')
        debugLog('[PlayerMode] 所有玩家是否都已准备:', allPlayersReady)

        if (allPlayersReady) {
          debugLog('[PlayerMode] 所有玩家已确认中心城市，自动进入部署界面')
          currentStep.value = 'city-deployment'
        }
      }

      // 先计算allDeployed（后续HP检测和战斗触发都需要）
      const allDeployed = data.gameState?.playerStates
        ? data.players.every(p => {
            const state = data.gameState.playerStates[p.name]
            // 关键修复：确保currentBattleCities是数组（Firebase可能返回对象）
            const battleCities = Array.isArray(state?.currentBattleCities)
              ? state.currentBattleCities
              : (state?.currentBattleCities ? Object.values(state.currentBattleCities) : [])
            const deployed = state && (
              battleCities.length > 0 ||
              state.battleGoldSkill === '按兵不动'
            )
            debugLog(`[PlayerMode] 检查${p.name}部署状态: deployed=${deployed}, currentBattleCities=${battleCities.length}, battleGoldSkill=${state?.battleGoldSkill}`)
            return deployed
          })
        : false

      // 增强诊断日志：记录战斗触发条件
      const triggerTimestamp = Date.now()
      debugLog(`[PlayerMode] ===== 战斗触发检查 (${triggerTimestamp}) =====`)
      debugLog('[PlayerMode] allDeployed:', allDeployed)
      debugLog('[PlayerMode] data.gameState.battleProcessed:', data.gameState.battleProcessed)
      debugLog('[PlayerMode] data.gameState.battleCalculated:', data.gameState.battleCalculated)
      debugLog('[PlayerMode] data.gameState.battleLock:', data.gameState.battleLock)
      debugLog('[PlayerMode] isBattleProcessing.value:', isBattleProcessing.value)
      debugLog('[PlayerMode] 当前玩家:', currentPlayer.value.name)
      debugLog('[PlayerMode] 第一个玩家:', data.players[0]?.name)
      debugLog('[PlayerMode] 是否为第一个玩家:', data.players[0]?.name === currentPlayer.value.name)

      // 死锁检测与自动恢复
      // 情况1: battleCalculated=true 但 battleLock已释放 且 battleProcessed=false
      //   → processBattle在设置battleCalculated后失败，错误处理释放了锁但没清除battleCalculated
      // 情况2: battleLock 设置超过30秒
      //   → 处理战斗的客户端崩溃或断线，锁永远不会被释放
      if (allDeployed && !data.gameState.battleProcessed && !isBattleProcessing.value) {
        let stuckReason = null
        if (data.gameState.battleCalculated && !data.gameState.battleLock) {
          // battleCalculated已设置但锁已释放 → 处理方已失败并释放了锁
          stuckReason = 'battleCalculated已设置但battleLock已释放（processBattle失败后的残留状态）'
        } else if (data.gameState.battleLock && typeof data.gameState.battleLock === 'number') {
          const lockAge = Date.now() - data.gameState.battleLock
          if (lockAge > 30000) {
            stuckReason = `battleLock已持续${Math.round(lockAge/1000)}秒（处理方可能崩溃）`
          }
        }
        if (stuckReason) {
          console.warn(`[PlayerMode] ⚠️ 死锁检测：${stuckReason}，自动清除`)
          try {
            await updateRoomGameState(currentRoomId.value, {
              battleCalculated: null,
              battleLock: null,
              battleError: `死锁自动恢复：${stuckReason}`
            })
            debugLog('[PlayerMode] ✅ 死锁已自动清除，下次onValue将重新触发战斗')
            battleRetryCount.value = 0
            return
          } catch (e) {
            console.error('[PlayerMode] 清除死锁失败:', e)
          }
        }
      }

      if (allDeployed && !data.gameState.battleProcessed && !data.gameState.battleCalculated && !data.gameState.battleLock && !isBattleProcessing.value) {
        // 关键防护：验证players数量足够（2P模式至少需要2个玩家）
        const expectedPlayers = (data.mode === '3P' || data.mode === '3p') ? 3 : 2
        if (!data.players || data.players.length < expectedPlayers) {
          console.error(`[PlayerMode] ❌ 玩家数量不足: ${data.players?.length}/${expectedPlayers}，尝试重新获取数据`)
          // Re-fetch from Firebase to get fresh data
          const freshData = await getRoomData(currentRoomId.value)
          if (!freshData || !freshData.players || freshData.players.length < expectedPlayers) {
            console.error(`[PlayerMode] ❌ 重新获取后仍不足: ${freshData?.players?.length}/${expectedPlayers}，跳过本次战斗触发`)
            return
          }
          // Use fresh data instead - replace data reference for processBattle
          Object.assign(data, freshData)
          data.players?.forEach(p => normalizePlayerCities(p))
          debugLog(`[PlayerMode] ✅ 重新获取数据成功，玩家数量: ${data.players.length}`)
        }

        debugLog(`[PlayerMode] 战斗触发条件满足 (${triggerTimestamp})`)

        // 检查重试次数限制
        if (battleRetryCount.value >= BATTLE_MAX_RETRIES) {
          console.error(`[PlayerMode] ❌ 已达最大重试次数(${BATTLE_MAX_RETRIES})，本客户端停止重试，清除锁让对方尝试`)
          // 关键修复：清除所有锁和标记，让对方客户端有机会尝试处理
          try {
            await updateRoomGameState(currentRoomId.value, {
              battleCalculated: null,
              battleLock: null,
              battleError: `${currentPlayer.value.name}重试${BATTLE_MAX_RETRIES}次失败，等待对方处理`
            })
          } catch (e) {
            console.error('[PlayerMode] 清除重试锁失败:', e)
          }
        }
        // 任意玩家都可以尝试触发战斗，通过Firebase事务锁保证只有一个玩家实际处理
        // 避免仅依赖第一个玩家处理导致的卡死问题
        else {
          debugLog(`[PlayerMode] 玩家${currentPlayer.value.name}尝试处理战斗 (${triggerTimestamp}), 重试次数: ${battleRetryCount.value}`)

          // 设置本地标志，防止同一客户端重复调用
          isBattleProcessing.value = true

          try {
            // 使用Firebase事务尝试获取战斗锁（独立于battleProcessed）
            const lockAcquired = await tryAcquireBattleLock(currentRoomId.value)

            if (lockAcquired) {
              debugLog(`[PlayerMode] ✅ 成功获取战斗锁，开始处理战斗 (${triggerTimestamp})`)
              await processBattle(data)
              debugLog(`[PlayerMode] ✅ 战斗处理完成 (${triggerTimestamp})`)
              // 战斗成功，重置重试计数
              battleRetryCount.value = 0
            } else {
              debugLog(`[PlayerMode] ⚠️ 未能获取战斗锁，其他客户端已在处理 (${triggerTimestamp})`)
            }
          } catch (error) {
            console.error(`[PlayerMode] ❌ 战斗处理异常 (${triggerTimestamp}):`, error)
            battleRetryCount.value++
            // 释放战斗锁、清除battleCalculated，记录错误
            // 关键修复：必须同时清除battleCalculated，否则会导致死锁
            // 如果processBattle在设置battleCalculated=true之后失败，
            // 触发条件会检查!battleCalculated而永远阻塞，战斗永远不会重试
            try {
              await releaseBattleLock(currentRoomId.value)
              await updateRoomGameState(currentRoomId.value, {
                battleError: error.message || '战斗处理异常',
                battleCalculated: null,  // 清除，允许重试
                battleLock: null         // 确保锁也被清除
              })
              debugLog(`[PlayerMode] 已释放战斗锁并清除battleCalculated，重试次数: ${battleRetryCount.value}/${BATTLE_MAX_RETRIES}`)
            } catch (resetError) {
              console.error('[PlayerMode] 释放战斗锁失败:', resetError)
              // 即使partial update失败，也尝试单独清除关键字段
              try {
                await updateRoomGameState(currentRoomId.value, { battleCalculated: null, battleLock: null })
              } catch (e) {
                console.error('[PlayerMode] 紧急清除battleCalculated也失败:', e)
              }
            }
          } finally {
            isBattleProcessing.value = false
          }
        }
      } else {
        debugLog(`[PlayerMode] 战斗触发条件不满足 (${triggerTimestamp})`)
      }

      // 关键修复：检查是否需要显示战斗动画（统一处理所有玩家）
      debugLog('[PlayerMode] ===== 监听器动画检查 (玩家:', currentPlayer.value.name, ') =====')
      debugLog('[PlayerMode] 监听器检查动画显示条件:')
      debugLog('  - battleProcessed:', data.gameState.battleProcessed)
      debugLog('  - battleAnimationData存在:', !!data.gameState.battleAnimationData)
      debugLog('  - showBattleAnimation.value:', showBattleAnimation.value)
      debugLog('  - currentStep.value:', currentStep.value)

      // ===== 诊断：详细检查battleAnimationData =====
      if (data.gameState.battleAnimationData) {
        debugLog('[PlayerMode] battleAnimationData详情:')
        debugLog('  - round:', data.gameState.battleAnimationData.round)
        debugLog('  - specialEvent:', data.gameState.battleAnimationData.specialEvent)
        debugLog('  - player1.name:', data.gameState.battleAnimationData.player1?.name)
        debugLog('  - player1.cities数量:', data.gameState.battleAnimationData.player1?.cities?.length || 0)
        debugLog('  - player1.totalAttack:', data.gameState.battleAnimationData.player1?.totalAttack || 0)
        debugLog('  - player2.name:', data.gameState.battleAnimationData.player2?.name)
        debugLog('  - player2.cities数量:', data.gameState.battleAnimationData.player2?.cities?.length || 0)
        debugLog('  - player2.totalAttack:', data.gameState.battleAnimationData.player2?.totalAttack || 0)
      } else if (data.gameState.battleProcessed) {
        // 只有当battleProcessed=true但battleAnimationData缺失时才报错
        // 这说明战斗已处理但动画数据丢失，可能是Firebase保存竞态问题
        console.error('[PlayerMode] ❌ battleProcessed=true但battleAnimationData不存在！')
        console.error('[PlayerMode] data.gameState keys:', Object.keys(data.gameState || {}))
        console.error('[PlayerMode] 可能原因：1) 数据未保存到Firebase  2) 监听器接收的数据不完整  3) 数据被其他地方清空')
      } else {
        // battleProcessed=false时，battleAnimationData不存在是正常的（战斗尚未发生）
        debugLog('[PlayerMode] battleAnimationData尚未生成（battleProcessed=false，属正常状态）')
      }
      debugLog('[PlayerMode] ===========================================')

      // battleProcessed 和 battleAnimationData 现在通过同一次 saveRoomData 原子保存
      // 极少数情况下可能出现不一致，做一次重读作为安全网
      let animationData = data.gameState.battleAnimationData
      if (data.gameState.battleProcessed && !animationData && !showBattleAnimation.value) {
        debugLog('[PlayerMode] battleProcessed=true但battleAnimationData缺失，尝试重读...')
        await new Promise(resolve => setTimeout(resolve, 1000))
        const freshData = await getRoomData(currentRoomId.value)
        if (freshData?.gameState?.battleAnimationData) {
          debugLog('[PlayerMode] ✅ 重读成功，battleAnimationData已就绪')
          animationData = freshData.gameState.battleAnimationData
          data.gameState = freshData.gameState
        } else {
          console.error('[PlayerMode] ❌ 重读后battleAnimationData仍不存在')
        }
      }

      if (data.gameState.battleProcessed &&
          animationData &&
          !showBattleAnimation.value) {

        debugLog('[PlayerMode] 监听器检测到战斗已完成，准备显示动画')
        debugLog('[PlayerMode] 当前玩家:', currentPlayer.value.name)
        debugLog('[PlayerMode] 动画数据回合:', animationData.round)
        debugLog('[PlayerMode] 当前回合:', data.gameState.currentRound)

        // 关键修复：验证动画数据完整性（使用轮询后的animationData）
        const animData = animationData
        if (!animData || !animData.player1 || !animData.player2) {
          console.error('[PlayerMode] 动画数据不完整，跳过显示')
          // 如果数据不完整，直接进入下一回合
          currentStep.value = 'city-deployment'
          return
        }

        // 关键修复：检查是否是当前回合的动画，且该回合动画未展示过（防止同回合重复显示）
        if (animData.round === data.gameState.currentRound && animationShownForRound.value !== animData.round) {
          // 记录当前玩家是否为第一个玩家（用于后续清理）
          isFirstPlayerInRoom.value = data.players[0]?.name === currentPlayer.value.name

          // 标记此回合动画已显示，防止重复触发
          animationShownForRound.value = animData.round
          battleAnimationData.value = animData
          showBattleAnimation.value = true
          debugLog('[PlayerMode] 开始显示战斗动画（非阻塞）')

          // 关键修复：不再阻塞监听器等待动画完成
          // 动画完成后由 handleBattleAnimationComplete 处理清理和进入下一回合
          // 超时保护：如果30秒后动画仍未完成，强制触发完成
          setTimeout(() => {
            if (showBattleAnimation.value) {
              console.warn('[PlayerMode] 动画超时（30秒），强制完成')
              handleBattleAnimationComplete()
            }
          }, 30000)
        } else if (animData.round !== data.gameState.currentRound) {
          console.warn('[PlayerMode] 动画回合不匹配，跳过显示')
        }

        // 检查游戏是否结束（即使跳过动画也要检查）
        if (data.gameState.gameOver && !showVictory.value) {
          debugLog('[PlayerMode] 游戏结束，获胜者:', data.gameState.winner)
          showVictory.value = true
          stopAllOnGameOver()
          return
        }
      }
    }
  })
}

/**
 * 尝试获取战斗锁（使用Firebase事务）
 * 使用独立的 battleLock 字段，不影响 battleProcessed
 * @param {string} roomId - 房间ID
 * @returns {Promise<boolean>} - 是否成功获取锁
 */
async function tryAcquireBattleLock(roomId) {
  try {
    const { getDatabase, ref: dbRef, runTransaction } = await import('firebase/database')
    const db = getDatabase()
    const battleLockRef = dbRef(db, `rooms/${roomId}/gameState/battleLock`)

    const result = await runTransaction(battleLockRef, (currentValue) => {
      // 如果已被锁定，中止事务
      if (currentValue) {
        return undefined  // 中止事务
      }
      // 设置锁（使用时间戳）
      return Date.now()
    })

    // 如果事务提交成功，说明我们获取了锁
    return result.committed
  } catch (error) {
    console.error('[PlayerMode] 获取战斗锁失败:', error)
    return false
  }
}

/**
 * 释放战斗锁
 */
async function releaseBattleLock(roomId) {
  try {
    await updateRoomGameState(roomId, { battleLock: null })
  } catch (error) {
    console.error('[PlayerMode] 释放战斗锁失败:', error)
  }
}

/**
 * 战斗动画完成处理
 * 关键修复：将原来监听器中阻塞等待动画完成后的逻辑移到这里
 * 避免监听器长时间阻塞导致页面卡死
 */
async function handleBattleAnimationComplete() {
  debugLog('[PlayerMode] 战斗动画播放完成')
  showBattleAnimation.value = false
  battleAnimationData.value = null
  battleRetryCount.value = 0  // 新回合重置重试计数

  // 只有第一个玩家负责清理 Firebase 动画数据
  if (isFirstPlayerInRoom.value) {
    debugLog('[PlayerMode] 第一个玩家负责清理动画数据')

    // 等待一段时间确保第二个玩家也看完了动画
    await new Promise(resolve => setTimeout(resolve, 2000))

    const latestRoomData = await getRoomData(currentRoomId.value)
    if (latestRoomData && latestRoomData.gameState?.battleAnimationData) {
      const nextRound = (latestRoomData.gameState.currentRound || 1) + 1
      debugLog('[PlayerMode] 使用partial update清理动画数据，回合数+1:', nextRound)

      await updateRoomGameState(currentRoomId.value, {
        battleAnimationData: null,      // 删除
        specialEventThisRound: null,     // 删除
        fatigueThisRound: null,          // 删除
        battleProcessed: false,          // 重置
        battleCalculated: null,          // 重置（防止重试标记）
        battleLock: null,               // 释放锁
        battleError: null,               // 清理错误信息
        currentRound: nextRound          // 回合+1
      })
      debugLog('[PlayerMode] 数据清理完成（partial update），准备进入下一回合')
    }
  }

  // 等待一小段时间让玩家查看结果
  await new Promise(resolve => setTimeout(resolve, 1000))

  // 检查游戏是否结束
  const roomData = await getRoomData(currentRoomId.value)
  if (roomData?.gameState?.gameOver) {
    debugLog('[PlayerMode] 动画后检测到游戏结束，获胜者:', roomData.gameState.winner)
    if (!showVictory.value) {
      showVictory.value = true
      stopAllOnGameOver()
    }
    return
  }

  // 切换到部署界面
  debugLog('[PlayerMode] 自动进入下一回合部署')
  currentStep.value = 'city-deployment'
}

/**
 * 处理战斗
 * 参考 citycard_web.html 完整战斗流程
 */
async function processBattle(roomData) {
  // 诊断日志：记录processBattle调用
  const battleCallId = Date.now()
  debugLog(`[PlayerMode] ===== processBattle 被调用 (ID: ${battleCallId}) =====`)
  debugLog('[PlayerMode] 调用者:', new Error().stack.split('\n')[2])
  debugLog('[PlayerMode] 当前回合:', roomData.gameState.currentRound)
  debugLog('[PlayerMode] battleProcessed当前值:', roomData.gameState.battleProcessed)
  debugLog('[PlayerMode] 战斗前玩家数量:', roomData.players?.length)
  debugLog('[PlayerMode] 战斗前玩家金币:', roomData.players.map(p => ({ name: p.name, gold: p.gold })))

  // 关键防护：验证玩家数量（在所有处理之前）
  const expectedPlayers = (roomData.mode === '3P' || roomData.mode === '3p') ? 3 : 2
  if (!roomData.players || roomData.players.length < expectedPlayers) {
    console.error(`[PlayerMode] ❌ processBattle: 玩家数量不足 ${roomData.players?.length}/${expectedPlayers}，尝试重新获取`)
    const freshData = await getRoomData(currentRoomId.value)
    if (freshData && freshData.players && freshData.players.length >= expectedPlayers) {
      freshData.players.forEach(p => normalizePlayerCities(p))
      roomData.players = freshData.players
      debugLog(`[PlayerMode] ✅ processBattle: 从Firebase重新获取玩家数据成功，玩家数量: ${roomData.players.length}`)
    } else {
      throw new Error(`玩家数量不足: ${roomData.players?.length}/${expectedPlayers}，无法处理战斗`)
    }
  }

  // 诊断：显示战斗前的streak状态
  debugLog('[PlayerMode] ===== 战斗前streak状态 =====')
  roomData.players.forEach(player => {
    debugLog(`[PlayerMode] ${player.name} 的streaks:`, player.streaks || '(未定义)')
    const gamePlayer = gameStore.players.find(p => p.name === player.name)
    if (gamePlayer) {
      debugLog(`[PlayerMode] ${player.name} gameStore中的streaks:`, gamePlayer.streaks || '(未定义)')
    }
  })
  debugLog('[PlayerMode] ======================================')

  debugLog('[PlayerMode] 开始处理战斗')

  // 防止重复处理：如果战斗已经处理过或已计算过，直接返回
  if (roomData.gameState.battleProcessed || roomData.gameState.battleCalculated) {
    debugLog(`[PlayerMode] 战斗已处理过 (battleCallId: ${battleCallId}, battleProcessed=${roomData.gameState.battleProcessed}, battleCalculated=${roomData.gameState.battleCalculated})，跳过重复处理`)
    return
  }

  // 关键修复：先准备动画数据，然后和battleProcessed=true一起保存
  // 这样监听器检测到battleProcessed时，battleAnimationData也已经存在
  debugLog('[PlayerMode] 先准备动画数据，稍后和battleProcessed一起保存')

  // 诊断：验证早期保存后roomData.gameState.knownCities的状态
  debugLog('[PlayerMode] ===== 战斗前数据验证 =====')
  debugLog('[PlayerMode] roomData.gameState.knownCities存在:', !!roomData.gameState?.knownCities)
  debugLog('[PlayerMode] roomData.gameState.knownCities内容:', JSON.stringify(roomData.gameState?.knownCities, null, 2))
  debugLog('[PlayerMode] ========================================')

  // ===== 战斗前数据验证 =====
  debugLog('[PlayerMode] ===== 战斗前数据验证 =====')
  roomData.players.forEach(player => {
    debugLog(`[PlayerMode] ${player.name} cities:`, Object.values(player.cities).map(c => c.name))
    const state = roomData.gameState.playerStates[player.name]
    if (state && state.currentBattleCities) {
      state.currentBattleCities.forEach(card => {
        const city = player.cities[card.cityName]
        debugLog(`[PlayerMode] ${player.name} 出战城市 cityName=${card.cityName}, actualName=${city?.name}`)
      })
    }
  })

  // 初始化战斗日志数组（如果还没有）
  if (!roomData.gameState.battleLogs) {
    roomData.gameState.battleLogs = []
  }

  // 不清空日志，保留历史记录（像HTML版本一样累积）
  // 注释掉：gameStore.clearLogs()
  debugLog(`[PlayerMode] 当前已有${gameStore.logs.length}条历史日志，继续追加新日志`)

  const mode = roomData.mode || '2P'
  debugLog(`[PlayerMode] 当前游戏模式: ${mode}`)

  // ========== Normalize roomData.players before any processing ==========
  // Firebase converts {cityName: obj} to arrays and centerCityName to numbers
  // Also handles objects with numeric string keys (sparse array conversion)
  for (const player of roomData.players) {
    normalizePlayerCities(player)
    let ccn = player.centerCityName
    if (typeof ccn === 'number' || (typeof ccn === 'string' && !isNaN(ccn) && !player.cities[ccn])) {
      const cityNames = Object.keys(player.cities)
      ccn = cityNames[Number(ccn)] || cityNames[0]
      player.centerCityName = ccn
    }
    if (!ccn || !player.cities[ccn]) {
      player.centerCityName = Object.keys(player.cities)[0] || null
    }
  }

  // ========== 疲劳减半：在战斗前检测之前执行 ==========
  // 关键：按照用户需求，疲劳减半必须在同省规则检查之前执行

  // 关键修复：使用roomData中的streaks（直接来自Firebase快照，是权威数据源）
  // 不再从gameStore复制streaks，因为onValue监听器中的syncRoomDataToGameStore
  // 可能在processBattle的await期间用旧的Firebase数据覆盖gameStore.streaks，
  // 导致下一轮战斗读取到错误的streak值，错误触发疲劳减半
  debugLog('[PlayerMode] ===== 战斗前验证streaks（使用Firebase权威数据） =====')
  roomData.players.forEach(player => {
    if (!player.streaks || typeof player.streaks !== 'object') {
      // Firebase可能strip空对象，此时默认为无疲劳（所有streak=0）
      player.streaks = {}
      debugLog(`[PlayerMode] ${player.name}的streaks为空，初始化为{}（无疲劳）`)
    } else {
      debugLog(`[PlayerMode] ${player.name}的streaks（来自Firebase）:`, player.streaks)
    }
  })
  debugLog('[PlayerMode] ==========================================')

  const { applyFatigueReduction } = await import('../../composables/game/fatigueSystem.js')
  applyFatigueReduction(gameStore, roomData.gameState, roomData.players, mode)

  // 清除本轮复活城市标记（已在applyFatigueReduction中使用完毕）
  Object.keys(gameStore.revivedCities).forEach(key => delete gameStore.revivedCities[key])

  // ========== 战斗前检测（参考 citycard_web.html lines 3946-4510） ==========
  const { executePreBattleChecks } = await import('../../composables/game/preBattleChecks.js')

  // 执行战斗前检测（会清空出战城市如果触发特殊事件，但不跳过战斗）
  executePreBattleChecks(gameStore, roomData.gameState, roomData.players, mode)

  // 关键修复：同步specialEventThisRound到gameStore，供战斗计算使用
  if (roomData.gameState.specialEventThisRound) {
    gameStore.specialEventThisRound = roomData.gameState.specialEventThisRound
    debugLog('[PlayerMode] ✅ 已同步specialEventThisRound到gameStore:', gameStore.specialEventThisRound)
  } else {
    // 清除上一回合的特殊事件
    if (gameStore.specialEventThisRound) {
      delete gameStore.specialEventThisRound
      debugLog('[PlayerMode] 已清除gameStore.specialEventThisRound')
    }
  }

  // 关键修复Issue #3：立即同步roomData到gameStore，确保城市转移（省会归顺）被反映
  // executePreBattleChecks可能会转移城市（从防守方到攻击方），这些修改必须同步到gameStore
  debugLog('[PlayerMode] executePreBattleChecks执行完毕，立即同步roomData到gameStore')
  debugLog('[PlayerMode] 同步前gameStore.players数量:', gameStore.players.map(p => ({ name: p.name, cities: Object.keys(p.cities).length })))
  syncRoomDataToGameStore(roomData)
  debugLog('[PlayerMode] 同步后gameStore.players数量:', gameStore.players.map(p => ({ name: p.name, cities: Object.keys(p.cities).length })))

  // 关键修复Issue #1：立即将 gameStore.knownCities 同步回 roomData，确保归顺时标记的已知城市被保存
  // executePreBattleChecks 中调用了 setCityKnown()，这些修改需要立即同步到 roomData
  debugLog('[PlayerMode] ===== executePreBattleChecks后立即同步knownCities =====')
  if (!roomData.gameState.knownCities) {
    roomData.gameState.knownCities = {}
  }
  Object.keys(gameStore.knownCities).forEach(observer => {
    if (!roomData.gameState.knownCities[observer]) {
      roomData.gameState.knownCities[observer] = {}
    }
    Object.keys(gameStore.knownCities[observer]).forEach(owner => {
      roomData.gameState.knownCities[observer][owner] = [...gameStore.knownCities[observer][owner]]
      debugLog(`[PlayerMode] 预先同步knownCities: knownCities[${observer}][${owner}] = [${roomData.gameState.knownCities[observer][owner].join(', ')}]`)
    })
  })
  debugLog('[PlayerMode] knownCities已预先同步到roomData:', JSON.stringify(roomData.gameState.knownCities, null, 2))

  // 关键修复Bug2（疲劳）：同步streaks到roomData
  // executePreBattleChecks中可能修改了gameStore.players[].streaks（城市转移时），需要同步到roomData
  debugLog('[PlayerMode] ===== 同步streaks到roomData =====')
  roomData.players.forEach((roomPlayer, idx) => {
    const gamePlayer = gameStore.players.find(p => p.name === roomPlayer.name)
    if (gamePlayer && gamePlayer.streaks) {
      roomPlayer.streaks = { ...gamePlayer.streaks }
      debugLog(`[PlayerMode] 同步${roomPlayer.name}的streaks:`, roomPlayer.streaks)
    }
  })
  debugLog('[PlayerMode] ==========================================')

  // ========== 准备战斗动画数据（在战斗前检测之后） ==========
  // 关键修复：必须在executePreBattleChecks之后准备，这样才能读取到specialEventThisRound
  const { prepareBattleAnimationData, updateBattleResults } = await import('../../composables/game/battleAnimationData.js')

  debugLog('[PlayerMode] 准备战斗动画数据（在战斗前检测之后）')

  // 关键修复：添加try-catch捕获可能的异常
  try {
    battleAnimationData.value = prepareBattleAnimationData(roomData, gameStore)
    debugLog('[PlayerMode] 战斗动画数据已准备:', battleAnimationData.value)
    debugLog('[PlayerMode] 特殊事件:', battleAnimationData.value?.specialEvent)

    // 验证动画数据的有效性
    if (!battleAnimationData.value) {
      console.error('[PlayerMode] ❌ prepareBattleAnimationData返回null！')
      console.error('[PlayerMode] roomData.mode:', roomData.mode)
      console.error('[PlayerMode] players.length:', roomData.players?.length)
      console.error('[PlayerMode] playerStates存在:', !!roomData.gameState?.playerStates)
      throw new Error('prepareBattleAnimationData返回null')
    }

    if (!battleAnimationData.value.player1 || !battleAnimationData.value.player2) {
      console.error('[PlayerMode] ❌ battleAnimationData缺少player1或player2！')
      throw new Error('battleAnimationData数据不完整')
    }
  } catch (error) {
    console.error('[PlayerMode] ❌ 准备战斗动画数据时出错:', error)
    console.error('[PlayerMode] 错误堆栈:', error.stack)
    console.error('[PlayerMode] roomData:', JSON.stringify(roomData, null, 2))

    // 关键修复：使用partial update而非全量set，避免覆盖其他数据
    // 不设置battleProcessed=true，让外层catch重置为false以允许重试
    try {
      await updateRoomGameState(currentRoomId.value, {
        battleError: error.message || '准备战斗动画数据失败'
      })
    } catch (updateErr) {
      console.error('[PlayerMode] 保存战斗错误信息失败:', updateErr)
    }

    throw error // 重新抛出异常，让外层捕获
  }

  // 关键修复：移除"跳过战斗"逻辑
  // 用户反馈：晕头转向、同省撤退和归顺并没有跳过战斗，只是双方无伤不攻击而已
  // 这些都是正常的回合，金币+3会由正常战斗流程处理（useGameLogic.js中的battle2P/3P/2v2函数）
  // executePreBattleChecks()现在永远返回false，shouldSkipBattle永远为false
  // 即使城市被清空，战斗仍会继续，只是攻击力为0，不造成伤害
  debugLog('[PlayerMode] 战斗前检测完成，继续正常战斗流程（即使触发特殊事件也不跳过）')

  // ========== 标记出战城市为已知（双方互相知道对方出战的城市） ==========
  // 关键修复：必须在战斗计算之前标记，因为战斗函数会清空currentBattleCities
  // 参考 citycard_web.html lines 42982-42988
  debugLog('[PlayerMode] ===== 开始标记knownCities =====')
  debugLog('[PlayerMode] 标记前 roomData.gameState.knownCities:', roomData.gameState.knownCities)

  if (!roomData.gameState.knownCities) {
    roomData.gameState.knownCities = {}
    debugLog('[PlayerMode] 初始化 knownCities 为空对象')
  }

  // 关键修复：使用前缀防止Firebase将纯数字玩家名转换为数组索引
  // Firebase会将 {"123": {...}, "456": {...}} 转换为稀疏数组，导致大量null
  function _prefixPlayer(name) {
    return 'p_' + name
  }

  // 2P模式
  debugLog('[PlayerMode] 检查2P模式条件: mode=', mode, 'players.length=', roomData.players.length)
  if (mode === '2P' && roomData.players.length === 2) {
    const player0 = roomData.players[0]
    const player1 = roomData.players[1]
    const state0 = roomData.gameState.playerStates[player0.name]
    const state1 = roomData.gameState.playerStates[player1.name]

    debugLog('[PlayerMode] ===== 标记已知城市 =====')
    debugLog('[PlayerMode] player0:', player0.name, 'cities:', Object.values(player0.cities).map(c => c.name))
    debugLog('[PlayerMode] player1:', player1.name, 'cities:', Object.values(player1.cities).map(c => c.name))

    if (state0 && state1) {
      // player0的出战城市被player1知道
      debugLog('[PlayerMode] player0出战城市:', state0.currentBattleCities?.map(c => c.cityName))
      const observer1Key = _prefixPlayer(player1.name)
      const owner0Key = _prefixPlayer(player0.name)

      state0.currentBattleCities?.forEach(card => {
        const cityName = card.cityName
        // 关键修复：生于紫室的城市不标记为已知
        if (gameStore.purpleChamber && gameStore.purpleChamber[player0.name] === cityName) {
          debugLog(`[PlayerMode] 跳过标记player0的${cityName}为已知（生于紫室保护）`)
          return
        }
        debugLog(`[PlayerMode] player1知道player0的城市: cityName=${cityName}`)

        if (!roomData.gameState.knownCities[observer1Key]) {
          roomData.gameState.knownCities[observer1Key] = {}
        }
        if (!roomData.gameState.knownCities[observer1Key][owner0Key]) {
          roomData.gameState.knownCities[observer1Key][owner0Key] = []
        }
        if (!roomData.gameState.knownCities[observer1Key][owner0Key].includes(cityName)) {
          roomData.gameState.knownCities[observer1Key][owner0Key].push(cityName)
        }
      })

      // player1的出战城市被player0知道
      debugLog('[PlayerMode] player1出战城市:', state1.currentBattleCities?.map(c => c.cityName))
      const observer0Key = _prefixPlayer(player0.name)
      const owner1Key = _prefixPlayer(player1.name)

      state1.currentBattleCities?.forEach(card => {
        const cityName = card.cityName
        // 关键修复：生于紫室的城市不标记为已知
        if (gameStore.purpleChamber && gameStore.purpleChamber[player1.name] === cityName) {
          debugLog(`[PlayerMode] 跳过标记player1的${cityName}为已知（生于紫室保护）`)
          return
        }
        debugLog(`[PlayerMode] player0知道player1的城市: cityName=${cityName}`)

        if (!roomData.gameState.knownCities[observer0Key]) {
          roomData.gameState.knownCities[observer0Key] = {}
        }
        if (!roomData.gameState.knownCities[observer0Key][owner1Key]) {
          roomData.gameState.knownCities[observer0Key][owner1Key] = []
        }
        if (!roomData.gameState.knownCities[observer0Key][owner1Key].includes(cityName)) {
          roomData.gameState.knownCities[observer0Key][owner1Key].push(cityName)
        }
      })

      debugLog('[PlayerMode] 最终knownCities:', JSON.stringify(roomData.gameState.knownCities, null, 2))
    }
  }

  debugLog('[PlayerMode] ===== knownCities标记完成 =====')
  debugLog('[PlayerMode] 标记后 roomData.gameState.knownCities存在:', !!roomData.gameState.knownCities)
  debugLog('[PlayerMode] 标记后 knownCities内容:', JSON.stringify(roomData.gameState.knownCities, null, 2))
  debugLog('[PlayerMode] ==========================================')

  // ========== 执行战斗计算 ==========
  // 关键修复：快照战斗前的streaks，如果战斗计算失败可以回滚
  // 防止重试时使用已被updateFatigueStreaks修改的错误streak值
  const streaksSnapshot = {}
  roomData.players.forEach(player => {
    streaksSnapshot[player.name] = player.streaks ? { ...player.streaks } : {}
  })
  const gameStoreStreaksSnapshot = {}
  gameStore.players.forEach(player => {
    gameStoreStreaksSnapshot[player.name] = player.streaks ? { ...player.streaks } : {}
  })

  // 记录战斗前日志数量，便于失败时回滚（防止重试时日志重复）
  const logCountBeforeBattle = gameStore.logs.length

  // 记录战斗前已阵亡的城市，用于检测本轮新阵亡的城市（触发守望相助等）
  const deadBeforeBattle = new Set()
  for (const player of roomData.players) {
    Object.entries(player.cities).forEach(([cityName, city]) => {
      if (city.isAlive === false || (city.currentHp !== undefined && city.currentHp <= 0)) {
        deadBeforeBattle.add(`${player.name}:${cityName}`)
      }
    })
  }

  // 关键修复：确保所有城市都有 currentHp 初始化（防止 undefined 导致 NaN 伤害计算）
  // Firebase 可能不存储 undefined 值，导致 JSON.parse(JSON.stringify) 后 currentHp 丢失
  for (const player of roomData.players) {
    Object.entries(player.cities).forEach(([cityName, city]) => {
      if (city.currentHp === undefined || city.currentHp === null) {
        city.currentHp = city.hp || 0
      }
    })
  }

  // 关键修复：包裹在try-catch中，确保异常时能正确恢复battleProcessed
  try {
  if (mode === '3P' || mode === '3p') {
    gameLogic.battle3P(roomData.players, roomData.gameState)
  } else if (mode === '2v2' || mode === '2V2') {
    gameLogic.battle2v2(roomData.players, roomData.gameState)
  } else {
    gameLogic.battle2P(roomData.players, roomData.gameState)
  }

  // 关键修复：battle计算完成后，立即通过partial update标记battleCalculated=true
  // 防止后续代码出错时外层catch释放锁导致重复战斗触发
  // battle函数已修改了streaks等状态，重复执行会导致疲劳错误累积
  // 注意：使用battleCalculated而非battleProcessed，因为battleProcessed会触发对手显示动画
  // 此时battleAnimationData尚未保存，对手会看到"battleProcessed=true但battleAnimationData不存在"
  try {
    await updateRoomGameState(currentRoomId.value, {
      battleCalculated: true
    })
    debugLog('[PlayerMode] ✅ 战斗完成后立即标记battleCalculated=true（防止重试，不触发动画）')
  } catch (markError) {
    console.error('[PlayerMode] ⚠️ 标记battleCalculated失败，继续执行:', markError)
  }

  // 同步knownCities到gameStore
  debugLog('[PlayerMode] ===== 同步knownCities到gameStore =====')
  debugLog('[PlayerMode] roomData.gameState.knownCities:', JSON.stringify(roomData.gameState.knownCities, null, 2))
  if (roomData.gameState.knownCities) {
    Object.keys(roomData.gameState.knownCities).forEach(observer => {
      if (!gameStore.knownCities[observer]) {
        gameStore.knownCities[observer] = {}
      }
      Object.keys(roomData.gameState.knownCities[observer]).forEach(owner => {
        // Firebase存储的是数组，gameStore需要Set
        const cities = roomData.gameState.knownCities[observer][owner]
        gameStore.knownCities[observer][owner] = new Set(Array.isArray(cities) ? cities : [])
        debugLog(`[PlayerMode] 同步: knownCities[${observer}][${owner}] = [${Array.from(gameStore.knownCities[observer][owner]).join(', ')}]`)
      })
    })
  }
  debugLog('[PlayerMode] gameStore.knownCities同步完成:', JSON.stringify(roomData.gameState.knownCities, null, 2))

  // 关键修复：执行战斗计算（会调用setCityKnown标记出战城市）
  // 这样gameStore.knownCities会被更新

  // 关键修复：战斗后将gameStore.knownCities同步回roomData.gameState.knownCities
  // 确保所有玩家通过Firebase看到已知城市
  if (!roomData.gameState.knownCities) {
    roomData.gameState.knownCities = {}
  }

  debugLog('[PlayerMode] ===== 同步gameStore.knownCities回roomData =====')
  Object.keys(gameStore.knownCities).forEach(observer => {
    if (!roomData.gameState.knownCities[observer]) {
      roomData.gameState.knownCities[observer] = {}
    }
    Object.keys(gameStore.knownCities[observer]).forEach(owner => {
      // gameStore存储的是Set，Firebase需要数组
      const cities = gameStore.knownCities[observer][owner]
      roomData.gameState.knownCities[observer][owner] = Array.from(cities instanceof Set ? cities : [])
      debugLog(`[PlayerMode] 反向同步: knownCities[${observer}][${owner}] = [${roomData.gameState.knownCities[observer][owner].join(', ')}]`)
    })
  })
  debugLog('[PlayerMode] knownCities已同步回roomData:', JSON.stringify(roomData.gameState.knownCities, null, 2))
  debugLog('[PlayerMode] ==========================================')

  // 同步actingCapital回roomData
  if (gameStore.actingCapital && Object.keys(gameStore.actingCapital).length > 0) {
    roomData.gameState.actingCapital = JSON.parse(JSON.stringify(gameStore.actingCapital))
  }

  // 同步mutualWatch回roomData（守望相助触发后可能已消耗效果）
  if (Object.keys(gameStore.mutualWatch).length > 0) {
    roomData.gameState.mutualWatch = JSON.parse(JSON.stringify(gameStore.mutualWatch))
  } else {
    roomData.gameState.mutualWatch = null
  }

  // 同步purpleChamber回roomData（生于紫室继承后可能已消耗）
  if (gameStore.purpleChamber && Object.keys(gameStore.purpleChamber).length > 0) {
    roomData.gameState.purpleChamber = JSON.parse(JSON.stringify(gameStore.purpleChamber))
  } else {
    roomData.gameState.purpleChamber = {}
  }

  // 同步electromagnetic回roomData
  if (gameStore.electromagnetic && Object.keys(gameStore.electromagnetic).length > 0) {
    roomData.gameState.electromagnetic = JSON.parse(JSON.stringify(gameStore.electromagnetic))
  } else {
    roomData.gameState.electromagnetic = {}
  }

  // 同步barrier回roomData
  if (gameStore.barrier && Object.keys(gameStore.barrier).length > 0) {
    roomData.gameState.barrier = JSON.parse(JSON.stringify(gameStore.barrier))
  } else {
    roomData.gameState.barrier = null
  }

  // 同步bannedCities回roomData
  if (gameStore.bannedCities && Object.keys(gameStore.bannedCities).length > 0) {
    roomData.gameState.bannedCities = JSON.parse(JSON.stringify(gameStore.bannedCities))
  } else {
    roomData.gameState.bannedCities = null
  }

  // 同步技能冷却回roomData
  if (gameStore.cooldowns && Object.keys(gameStore.cooldowns).length > 0) {
    roomData.gameState.cooldowns = JSON.parse(JSON.stringify(gameStore.cooldowns))
  } else {
    roomData.gameState.cooldowns = null
  }

  // ========== 更新战斗结果并保存到Firebase ==========
  if (battleAnimationData.value) {
    debugLog('[PlayerMode] ===== 保存战斗动画数据到Firebase =====')
    debugLog('[PlayerMode] battleAnimationData.value存在:', !!battleAnimationData.value)
    debugLog('[PlayerMode] battleAnimationData.value.round:', battleAnimationData.value.round)
    debugLog('[PlayerMode] battleAnimationData.value.player1:', battleAnimationData.value.player1?.name)
    debugLog('[PlayerMode] battleAnimationData.value.player2:', battleAnimationData.value.player2?.name)

    // 更新战斗结果数据
    updateBattleResults(battleAnimationData.value, roomData)
    debugLog('[PlayerMode] 战斗结果已更新到动画数据:', battleAnimationData.value.battleResults)

    // 关键修复：确保动画数据包含正确的回合数
    battleAnimationData.value.round = roomData.gameState.currentRound
    debugLog('[PlayerMode] 动画数据回合设置为:', battleAnimationData.value.round)

    // 关键修复：将对象转换为纯JSON，避免Firebase序列化错误
    // 使用JSON.parse(JSON.stringify())移除Proxy、函数等不可序列化的内容
    try {
      const plainBattleData = JSON.parse(JSON.stringify(battleAnimationData.value))
      roomData.gameState.battleAnimationData = plainBattleData
      debugLog('[PlayerMode] 战斗动画数据已转换为纯JSON并保存到roomData.gameState.battleAnimationData')
      debugLog('[PlayerMode] 验证: roomData.gameState.battleAnimationData存在:', !!roomData.gameState.battleAnimationData)
      debugLog('[PlayerMode] 验证: roomData.gameState.battleAnimationData.round:', roomData.gameState.battleAnimationData.round)
      debugLog('[PlayerMode] 验证: 数据大小（字节）:', JSON.stringify(plainBattleData).length)
    } catch (serializeError) {
      console.error('[PlayerMode] ❌ JSON序列化失败:', serializeError)
      console.error('[PlayerMode] battleAnimationData结构:', battleAnimationData.value)
      throw new Error(`battleAnimationData序列化失败: ${serializeError.message}`)
    }
    debugLog('[PlayerMode] ===========================================')
  } else {
    console.error('[PlayerMode] ❌ battleAnimationData.value为null，无法保存！')
  }

  // ========== 战斗后处理（参考 citycard_web.html lines 10036-10071） ==========
  // 检查城市阵亡和步步高升召唤（使用deadBeforeBattle检测本轮新阵亡的城市）
  for (const player of roomData.players) {
    Object.entries(player.cities).forEach(([cityName, city]) => {
      const isNewlyDead = city.currentHp <= 0 && !deadBeforeBattle.has(`${player.name}:${cityName}`)
      if (isNewlyDead) {
        // 城市阵亡
        city.isAlive = false

        // 清除生于紫室状态（阵亡后不保留）
        if (gameStore.purpleChamber && gameStore.purpleChamber[player.name] === cityName) {
          delete gameStore.purpleChamber[player.name]
          gameStore.addLog(`(生于紫室) ${player.name}的${cityName}阵亡，失去生于紫室加成`)
        }

        // 触发步步高升召唤
        gameStore.handleBuBuGaoShengSummon(player, cityName, city)

        // 触发守望相助：阵亡城市有守望相助效果时，从未使用城市池召唤同省城市
        debugLog(`[PlayerMode] 守望相助检查: ${player.name}的${cityName}阵亡, mutualWatch存在=${!!gameStore.mutualWatch}, 玩家条目=${!!gameStore.mutualWatch?.[player.name]}, 城市条目=${!!gameStore.mutualWatch?.[player.name]?.[cityName]}`)
        if (gameStore.mutualWatch && gameStore.mutualWatch[player.name] &&
            gameStore.mutualWatch[player.name][cityName]) {
          const watchData = gameStore.mutualWatch[player.name][cityName]
          // 获取有效省份（考虑拔旗易帜，触发时以当前有效省份为准）
          let targetProv = watchData.province
          if (gameStore.changeFlagMark &&
              gameStore.changeFlagMark[player.name] &&
              gameStore.changeFlagMark[player.name][cityName]) {
            targetProv = gameStore.changeFlagMark[player.name][cityName].newProvince
          }

          // 从未使用城市池中找同省城市（排除所有玩家已拥有的城市）
          const provinceCities = gameStore.getCitiesByProvince(targetProv)
          const allPlayerCityNames = new Set()
          for (const p of roomData.players) {
            Object.keys(p.cities).forEach(cn => allPlayerCityNames.add(cn))
          }
          const allUnused = gameStore.getUnusedCities()
          const unusedSet = new Set(allUnused.map(u => u.name))
          const unusedProvCities = provinceCities.filter(c =>
            unusedSet.has(c.name) && !allPlayerCityNames.has(c.name)
          )

          if (unusedProvCities.length > 0) {
            // 随机选一个
            const summonedCity = unusedProvCities[Math.floor(Math.random() * unusedProvCities.length)]
            const newCity = {
              ...summonedCity,
              currentHp: summonedCity.hp,
              isAlive: true
            }
            player.cities[summonedCity.name] = newCity
            gameStore.markCityAsUsed(summonedCity.name)
            gameStore.addLog(`(守望相助) ${cityName}阵亡，从${targetProv}未使用城市池中召唤了${summonedCity.name}(HP:${summonedCity.hp})`)
          } else {
            gameStore.addLog(`(守望相助) ${cityName}阵亡，但${targetProv}暂无未使用城市可召唤`)
          }

          // 消耗守望相助效果
          delete gameStore.mutualWatch[player.name][cityName]
        }
      }
    })

    // 检查中心城市阵亡和生于紫室继承
    gameStore.checkCenterDeathAndPurpleChamberInheritance(player)
  }

  // 关键修复：战斗后处理完成后，立即同步mutualWatch和purpleChamber到roomData
  // 防止后续syncRoomDataToGameStore用旧的roomData覆盖已消耗的守望相助/生于紫室状态
  roomData.gameState.mutualWatch = Object.keys(gameStore.mutualWatch).length > 0
    ? JSON.parse(JSON.stringify(gameStore.mutualWatch))
    : null
  roomData.gameState.purpleChamber = Object.keys(gameStore.purpleChamber).length > 0
    ? JSON.parse(JSON.stringify(gameStore.purpleChamber))
    : {}

  // 将战斗日志从gameStore复制到roomData
  roomData.gameState.battleLogs = [...gameStore.logs]

  // 关键修复：将gameStore.playerStates同步回roomData.gameState.playerStates
  // 这样游戏状态才能保存到Firebase
  if (gameStore.playerStates) {
    if (!roomData.gameState.playerStates) {
      roomData.gameState.playerStates = {}
    }
    roomData.gameState.playerStates = { ...gameStore.playerStates }
    debugLog('[PlayerMode] 同步playerStates到roomData:', roomData.gameState.playerStates)
  }

  // 标记战斗已处理
  roomData.gameState.battleProcessed = true
  debugLog('[PlayerMode] 战斗计算完成，标记battleProcessed=true')

  // 同步疲劳数据（streaks）：从roomData到gameStore
  // 关键修复：battle2P中的updateFatigueStreaks已更新roomData.players的streaks
  // 这里应该从roomData同步到gameStore，而不是反过来
  // 关键修复：使用name匹配而非index匹配，防止玩家顺序不一致导致streaks错乱
  roomData.players.forEach((roomPlayer) => {
    if (roomPlayer.streaks) {
      const gamePlayer = gameStore.players.find(p => p.name === roomPlayer.name)
      if (!gamePlayer) return
      gamePlayer.streaks = { ...roomPlayer.streaks }
      debugLog(`[PlayerMode] 同步${roomPlayer.name}的疲劳数据(roomData→gameStore):`, roomPlayer.streaks)
    }
  })

  // 关键修复：先同步 roomData 到 gameStore，确保 gameStore 有最新的战斗后数据（包括isAlive状态）
  // 必须在检查游戏结束之前同步，否则 isPlayerDefeated 会使用旧的 isAlive 状态
  debugLog('[PlayerMode] 战斗后同步 roomData 到 gameStore')
  syncRoomDataToGameStore(roomData)
  debugLog('[PlayerMode] 同步完成，gameStore.players 已更新')

  // 检查游戏是否结束（必须在同步 isAlive 状态之后）
  if (gameLogic.isGameOver.value) {
    debugLog('[PlayerMode] 游戏结束')
    // 保存游戏结束状态到Firebase
    roomData.gameState.gameOver = true
    roomData.gameState.winner = gameLogic.winner.value?.name || '平局'
    // 关键防护：如果玩家数量不足，使用partial update代替全量保存
    if (!roomData.players || roomData.players.length < 2) {
      console.warn('[PlayerMode] 游戏结束保存：玩家数量不足，使用partial update')
      await updateRoomGameState(currentRoomId.value, {
        gameOver: true,
        winner: roomData.gameState.winner,
        battleProcessed: true,
        battleAnimationData: roomData.gameState.battleAnimationData
      })
    } else {
      await saveRoomData(currentRoomId.value, roomData)
    }
    showVictory.value = true
    stopAllOnGameOver()
    return
  }

  // 关键修复：不要在这里执行currentRound++
  // 回合数应该在动画完成、清理数据后才增加
  // 否则会导致 battleAnimationData.round 和 currentRound 不匹配
  debugLog('[PlayerMode] 战斗完成，当前回合:', roomData.gameState.currentRound)

  // 注意：金币增加已由 useGameLogic.js 的 processNewRound() 函数处理
  // 该函数在 battle2P/battle3P/battle2v2 中被调用
  // 不需要在此处重复增加金币，否则会导致双倍增加
  debugLog(`[PlayerMode] 金币已由 battle 函数处理`)

  // 关键修复：调用 updateRoundStates() 处理金币贷款扣除等回合状态更新
  debugLog('[PlayerMode] 调用 gameStore.updateRoundStates() 处理回合状态更新')
  gameStore.updateRoundStates()
  debugLog('[PlayerMode] gameStore.updateRoundStates() 调用完成')

  // 关键修复：将 gameStore 中更新后的玩家数据同步回 roomData
  // 注意：battle2P 已直接修改了 roomData.players 的城市HP，syncRoomDataToGameStore也已同步
  // 这里的同步主要确保 updateRoundStates() 的修改（金币、bannedCities等）也在 roomData 中
  debugLog('[PlayerMode] 同步 gameStore 玩家数据到 roomData')
  roomData.players.forEach((roomPlayer, idx) => {
    const gamePlayer = gameStore.players.find(p => p.name === roomPlayer.name)
    if (gamePlayer) {
      // 同步金币（金币贷款扣除后的值）
      roomPlayer.gold = gamePlayer.gold
      debugLog(`[PlayerMode] 同步 ${roomPlayer.name} 的金币: ${roomPlayer.gold}`)

      // 同步城市HP和存活状态 - 保持对象结构
      roomPlayer.cities = {}
      Object.entries(gamePlayer.cities).forEach(([cityName, city]) => {
        roomPlayer.cities[cityName] = {
          ...city,
          currentHp: city.currentHp,
          isAlive: city.isAlive !== false
        }
      })
    }
  })

  // 清空所有玩家的部署状态
  // 关键修复：使用Firebase安全值代替空值，防止Firebase剥离导致playerStates丢失
  // Firebase会删除null、[]、{}值，如果所有属性都被删除，整个playerState也会消失
  Object.keys(roomData.gameState.playerStates).forEach(playerName => {
    const ps = roomData.gameState.playerStates[playerName]
    ps.currentBattleCities = []
    ps.confirmedBattleCitiesHpSnapshot = null
    ps.battleGoldSkill = null
    ps.battleGoldSkillData = null
    ps.activatedCitySkills = {}
    // 确保至少有一个Firebase不会剥离的值，防止整个playerState被删除
    if (!ps.deadCities || ps.deadCities.length === 0) {
      ps.deadCities = null
    }
    ps._initialized = true  // 哨兵值：确保playerState永远不为空对象
  })

  // 关键诊断：保存前最后验证knownCities
  debugLog('[PlayerMode] ===== 保存前最后验证 =====')
  debugLog('[PlayerMode] roomData.gameState存在:', !!roomData.gameState)
  debugLog('[PlayerMode] roomData.gameState.knownCities存在:', !!roomData.gameState?.knownCities)
  debugLog('[PlayerMode] 保存前knownCities内容:', JSON.stringify(roomData.gameState?.knownCities, null, 2))
  debugLog('[PlayerMode] roomData.gameState的所有keys:', roomData.gameState ? Object.keys(roomData.gameState) : 'undefined')
  debugLog('[PlayerMode] roomData.gameState.battleAnimationData存在:', !!roomData.gameState?.battleAnimationData)
  debugLog('[PlayerMode] ========================================')

  // 关键修复：确保守望相助消耗后的状态同步到roomData（防止saveRoomData丢失）
  if (Object.keys(gameStore.mutualWatch).length > 0) {
    roomData.gameState.mutualWatch = JSON.parse(JSON.stringify(gameStore.mutualWatch))
  } else {
    roomData.gameState.mutualWatch = null
  }

  // 同步金币贷款状态到roomData（updateRoundStates可能已递减）
  if (gameStore.goldLoanRounds && Object.keys(gameStore.goldLoanRounds).length > 0) {
    roomData.gameState.goldLoanRounds = JSON.parse(JSON.stringify(gameStore.goldLoanRounds))
  }

  // 关键修复：同步updateRoundStates()后的技能冷却到roomData
  if (gameStore.cooldowns && Object.keys(gameStore.cooldowns).length > 0) {
    roomData.gameState.cooldowns = JSON.parse(JSON.stringify(gameStore.cooldowns))
  } else {
    roomData.gameState.cooldowns = null
  }

  // 关键修复：显式同步skillUsageTracking到roomData，防止saveRoomData全量set()丢失数据
  if (gameStore.skillUsageTracking && Object.keys(gameStore.skillUsageTracking).length > 0) {
    roomData.gameState.skillUsageTracking = JSON.parse(JSON.stringify(gameStore.skillUsageTracking))
  }

  // 同步单回合技能花费
  if (gameStore.roundGoldSpent && Object.keys(gameStore.roundGoldSpent).length > 0) {
    roomData.gameState.roundGoldSpent = JSON.parse(JSON.stringify(gameStore.roundGoldSpent))
  }

  // 关键修复：同步updateRoundStates()后所有回合递减状态到roomData
  // 上方4760-4798处的同步发生在updateRoundStates()之前，这里确保保存后的值是递减后的正确值
  if (gameStore.bannedCities && Object.keys(gameStore.bannedCities).length > 0) {
    roomData.gameState.bannedCities = JSON.parse(JSON.stringify(gameStore.bannedCities))
  } else {
    roomData.gameState.bannedCities = null
  }
  if (gameStore.electromagnetic && Object.keys(gameStore.electromagnetic).length > 0) {
    roomData.gameState.electromagnetic = JSON.parse(JSON.stringify(gameStore.electromagnetic))
  } else {
    roomData.gameState.electromagnetic = null
  }
  if (gameStore.barrier && Object.keys(gameStore.barrier).length > 0) {
    roomData.gameState.barrier = JSON.parse(JSON.stringify(gameStore.barrier))
  } else {
    roomData.gameState.barrier = null
  }
  if (gameStore.anchored && Object.keys(gameStore.anchored).length > 0) {
    roomData.gameState.anchored = JSON.parse(JSON.stringify(gameStore.anchored))
  } else {
    roomData.gameState.anchored = null
  }
  if (gameStore.skillProtection && Object.keys(gameStore.skillProtection).length > 0) {
    roomData.gameState.skillProtection = JSON.parse(JSON.stringify(gameStore.skillProtection))
  } else {
    roomData.gameState.skillProtection = null
  }
  if (gameStore.stealth && Object.keys(gameStore.stealth).length > 0) {
    roomData.gameState.stealth = JSON.parse(JSON.stringify(gameStore.stealth))
  } else {
    roomData.gameState.stealth = null
  }
  if (gameStore.stareDown && Object.keys(gameStore.stareDown).length > 0) {
    roomData.gameState.stareDown = JSON.parse(JSON.stringify(gameStore.stareDown))
  } else {
    roomData.gameState.stareDown = null
  }
  if (gameStore.jianbukecui && Object.keys(gameStore.jianbukecui).length > 0) {
    roomData.gameState.jianbukecui = JSON.parse(JSON.stringify(gameStore.jianbukecui))
  } else {
    roomData.gameState.jianbukecui = null
  }
  if (gameStore.stolenSkills && Object.keys(gameStore.stolenSkills).length > 0) {
    roomData.gameState.stolenSkills = JSON.parse(JSON.stringify(gameStore.stolenSkills))
  } else {
    roomData.gameState.stolenSkills = null
  }
  if (gameStore.timeBombs && Object.keys(gameStore.timeBombs).length > 0) {
    roomData.gameState.timeBombs = JSON.parse(JSON.stringify(gameStore.timeBombs))
  } else {
    roomData.gameState.timeBombs = null
  }
  if (gameStore.disaster && Object.keys(gameStore.disaster).length > 0) {
    roomData.gameState.disaster = JSON.parse(JSON.stringify(gameStore.disaster))
  } else {
    roomData.gameState.disaster = null
  }
  if (gameStore.centerProjection && Object.keys(gameStore.centerProjection).length > 0) {
    roomData.gameState.centerProjection = JSON.parse(JSON.stringify(gameStore.centerProjection))
  } else {
    roomData.gameState.centerProjection = null
  }
  if (gameStore.financialCrisis) {
    roomData.gameState.financialCrisis = JSON.parse(JSON.stringify(gameStore.financialCrisis))
  } else {
    roomData.gameState.financialCrisis = null
  }

  // 关键修复：在最后保存前设置battleProcessed=true
  // 确保battleAnimationData和battleProcessed同时出现在Firebase
  roomData.gameState.battleProcessed = true
  debugLog('[PlayerMode] 已设置battleProcessed=true，准备保存')

  // 注意：不在这里清理fatigueThisRound，因为动画还需要这个数据
  // 清理会在动画完成后的清理阶段进行（见监听器中的清理逻辑）

  // 保存战斗结果（battleAnimationData和battleProcessed同时保存）
  debugLog('[PlayerMode] ===== 准备保存到Firebase =====')
  debugLog('[PlayerMode] roomData.gameState.battleProcessed:', roomData.gameState.battleProcessed)
  debugLog('[PlayerMode] roomData.gameState.battleAnimationData存在:', !!roomData.gameState.battleAnimationData)
  debugLog('[PlayerMode] roomData.gameState.currentRound:', roomData.gameState.currentRound)
  debugLog('[PlayerMode] roomData.players.length:', roomData.players?.length)

  // 关键防护：保存前验证玩家数量，防止写入损坏数据
  const expectedPlayersForSave = (roomData.mode === '3P' || roomData.mode === '3p') ? 3 : 2
  if (!roomData.players || roomData.players.length < expectedPlayersForSave) {
    console.error(`[PlayerMode] ❌ 保存前检测到玩家数量不足: ${roomData.players?.length}/${expectedPlayersForSave}，中止保存以防数据损坏`)
    // 仍然用partial update标记battleProcessed=true，避免卡死
    await updateRoomGameState(currentRoomId.value, {
      battleProcessed: true,
      battleAnimationData: roomData.gameState.battleAnimationData
    })
    return
  }

  await saveRoomData(currentRoomId.value, roomData)

  debugLog('[PlayerMode] ===== Firebase保存完成 =====')
  debugLog('[PlayerMode] 战斗数据已保存到Firebase，回合数:', roomData.gameState.currentRound)

  // 关键诊断：保存后立即读取验证
  const verifyData = await getRoomData(currentRoomId.value)
  if (verifyData && verifyData.gameState) {
    debugLog('[PlayerMode] ===== 验证Firebase数据 =====')
    debugLog('[PlayerMode] 验证: battleProcessed=', verifyData.gameState.battleProcessed)
    debugLog('[PlayerMode] 验证: battleAnimationData存在=', !!verifyData.gameState.battleAnimationData)
    if (verifyData.gameState.battleAnimationData) {
      debugLog('[PlayerMode] 验证: battleAnimationData.round=', verifyData.gameState.battleAnimationData.round)
      debugLog('[PlayerMode] 验证: battleAnimationData.player1=', verifyData.gameState.battleAnimationData.player1?.name)
      debugLog('[PlayerMode] 验证: battleAnimationData.player2=', verifyData.gameState.battleAnimationData.player2?.name)
    } else {
      console.error('[PlayerMode] ❌ 验证失败: battleAnimationData未保存到Firebase!')
    }
    debugLog('[PlayerMode] ========================================')
  }

  } catch (battleError) {
    // 战斗计算或保存过程中出错
    console.error('[PlayerMode] ❌ 战斗计算/保存过程中出错:', battleError)
    // 回滚日志到战斗前状态，防止重试时日志重复
    if (logCountBeforeBattle !== undefined && gameStore.logs.length > logCountBeforeBattle) {
      gameStore.logs.splice(logCountBeforeBattle)
      debugLog(`[PlayerMode] 已回滚日志到战斗前状态 (${logCountBeforeBattle}条)`)
    }
    // 关键修复：回滚streaks到战斗前状态，防止重试时错误累积疲劳
    if (streaksSnapshot) {
      roomData.players.forEach(player => {
        if (streaksSnapshot[player.name]) {
          player.streaks = { ...streaksSnapshot[player.name] }
        }
      })
      gameStore.players.forEach(player => {
        if (gameStoreStreaksSnapshot[player.name]) {
          player.streaks = { ...gameStoreStreaksSnapshot[player.name] }
        }
      })
      debugLog('[PlayerMode] 已回滚streaks到战斗前状态')
    }
    // 重新抛出让外层catch处理（外层会释放battleLock）
    throw battleError
  }
}

/**
 * 重新开始游戏
 */
function restartGame() {
  debugLog('[PlayerMode] 重新开始游戏')
  clearSession()

  // 重置游戏结束状态
  showVictory.value = false
  gameLogic.isGameOver.value = false
  gameLogic.winner.value = null

  // 重置gameStore
  gameStore.resetGame()

  // 重置到房间选择步骤
  currentStep.value = 'room-selection'
  currentRoomId.value = ''
  currentPlayer.value = null
  centerCityName.value = null
  playerDrawCount.value = 1
  isBattleProcessing.value = false
  battleRetryCount.value = 0
  isFirstPlayerInRoom.value = false
}
</script>

<style scoped>
#playerMode {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-x: hidden;
}

/* Network connection lines + glowing nodes */
#playerMode::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3C!-- Connection lines --%3E%3Cline x1='80' y1='120' x2='250' y2='200' stroke='rgba(96,165,250,0.08)' stroke-width='1'/%3E%3Cline x1='250' y1='200' x2='450' y2='150' stroke='rgba(56,189,248,0.07)' stroke-width='1'/%3E%3Cline x1='450' y1='150' x2='520' y2='320' stroke='rgba(96,165,250,0.06)' stroke-width='1'/%3E%3Cline x1='520' y1='320' x2='350' y2='400' stroke='rgba(56,189,248,0.07)' stroke-width='1'/%3E%3Cline x1='350' y1='400' x2='120' y2='350' stroke='rgba(96,165,250,0.06)' stroke-width='1'/%3E%3Cline x1='120' y1='350' x2='250' y2='200' stroke='rgba(56,189,248,0.05)' stroke-width='1'/%3E%3Cline x1='250' y1='200' x2='350' y2='400' stroke='rgba(96,165,250,0.05)' stroke-width='0.8'/%3E%3Cline x1='80' y1='120' x2='120' y2='350' stroke='rgba(56,189,248,0.04)' stroke-width='0.8'/%3E%3Cline x1='450' y1='150' x2='350' y2='400' stroke='rgba(96,165,250,0.04)' stroke-width='0.8'/%3E%3Cline x1='200' y1='500' x2='350' y2='400' stroke='rgba(56,189,248,0.05)' stroke-width='0.8'/%3E%3Cline x1='200' y1='500' x2='450' y2='520' stroke='rgba(96,165,250,0.04)' stroke-width='0.8'/%3E%3Cline x1='450' y1='520' x2='520' y2='320' stroke='rgba(56,189,248,0.05)' stroke-width='0.8'/%3E%3C!-- Nodes --%3E%3Ccircle cx='80' cy='120' r='3' fill='rgba(96,165,250,0.2)'/%3E%3Ccircle cx='250' cy='200' r='4' fill='rgba(56,189,248,0.25)'/%3E%3Ccircle cx='450' cy='150' r='3' fill='rgba(96,165,250,0.2)'/%3E%3Ccircle cx='520' cy='320' r='3.5' fill='rgba(56,189,248,0.22)'/%3E%3Ccircle cx='350' cy='400' r='4' fill='rgba(96,165,250,0.25)'/%3E%3Ccircle cx='120' cy='350' r='3' fill='rgba(56,189,248,0.2)'/%3E%3Ccircle cx='200' cy='500' r='3' fill='rgba(96,165,250,0.18)'/%3E%3Ccircle cx='450' cy='520' r='3.5' fill='rgba(56,189,248,0.2)'/%3E%3C/svg%3E");
  background-size: 100% 100%;
  pointer-events: none;
  z-index: 0;
  animation: networkPulse 8s ease-in-out infinite;
}

@keyframes networkPulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* City skyline with glowing windows */
#playerMode::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 25vh;
  clip-path: polygon(
    0% 100%,
    0% 72%, 2% 72%, 2% 58%, 4% 58%, 4% 72%,
    6% 72%, 6% 48%, 7.5% 48%, 7.5% 42%, 9% 42%, 9% 48%, 10% 48%, 10% 72%,
    13% 72%, 13% 52%, 15% 52%, 15% 36%, 16% 34%, 17% 36%, 17% 52%, 19% 52%, 19% 72%,
    22% 72%, 22% 62%, 24% 62%, 24% 44%, 26% 44%, 26% 62%, 28% 62%, 28% 72%,
    31% 72%, 31% 40%, 32% 36%, 33% 32%, 34% 36%, 35% 40%, 35% 72%,
    38% 72%, 38% 56%, 40% 56%, 40% 46%, 42% 46%, 42% 56%, 44% 56%, 44% 72%,
    47% 72%, 47% 50%, 48.5% 50%, 48.5% 28%, 49.5% 24%, 50.5% 28%, 50.5% 50%, 52% 50%, 52% 72%,
    55% 72%, 55% 60%, 57% 60%, 57% 46%, 59% 46%, 59% 60%, 61% 60%, 61% 72%,
    64% 72%, 64% 52%, 66% 52%, 66% 38%, 67% 35%, 68% 38%, 68% 52%, 70% 52%, 70% 72%,
    73% 72%, 73% 64%, 75% 64%, 75% 50%, 77% 50%, 77% 64%, 79% 64%, 79% 72%,
    82% 72%, 82% 44%, 83% 40%, 84% 44%, 84% 56%, 86% 56%, 86% 72%,
    89% 72%, 89% 60%, 91% 60%, 91% 50%, 93% 50%, 93% 60%, 95% 60%, 95% 72%,
    97% 72%, 97% 64%, 100% 64%, 100% 100%
  );
  background:
    /* Glowing windows */
    radial-gradient(1.5px 1.5px at 8% 55%, rgba(96,165,250,0.7) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 8.5% 62%, rgba(56,189,248,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 15.5% 45%, rgba(96,165,250,0.6) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 16% 50%, rgba(251,191,36,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 24.5% 52%, rgba(56,189,248,0.6) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 33% 42%, rgba(96,165,250,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 33.5% 50%, rgba(251,191,36,0.4) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 40.5% 52%, rgba(56,189,248,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 49.5% 38%, rgba(96,165,250,0.7) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 50% 45%, rgba(56,189,248,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 57.5% 52%, rgba(251,191,36,0.4) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 66.5% 44%, rgba(96,165,250,0.6) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 67% 50%, rgba(56,189,248,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 75.5% 56%, rgba(96,165,250,0.5) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 83.5% 50%, rgba(56,189,248,0.6) 50%, transparent 50%),
    radial-gradient(1.5px 1.5px at 91.5% 56%, rgba(251,191,36,0.4) 50%, transparent 50%),
    /* Building fill */
    linear-gradient(to top, #151530 0%, #1a1a3e 40%, rgba(26, 26, 62, 0.7) 100%);
  pointer-events: none;
  z-index: 0;
}

.exit-btn {
  position: absolute;
  top: 20px;
  left: 20px;
  padding: 10px 20px;
  background: var(--bad);
  border: 1px solid #dc2626;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-size: 14px;
  z-index: 100;
}

.exit-btn:hover {
  background: #dc2626;
}

.player-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  position: relative;
  z-index: 1;
}

.victory-modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(20, 30, 45, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.victory-content {
  background: linear-gradient(135deg, #2a2340 0%, #1e2a4a 100%);
  border: 2px solid rgba(212, 160, 23, 0.4);
  border-radius: 20px;
  padding: 36px 32px 28px;
  max-width: 520px;
  width: 90%;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.victory-animation {
  margin-bottom: 12px;
}

.trophy {
  font-size: 56px;
  animation: trophyFloat 2.5s ease-in-out infinite;
}

@keyframes trophyFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-12px) scale(1.05); }
}

.victory-title {
  font-size: 26px;
  font-weight: 700;
  color: #f0c040;
  margin-bottom: 6px;
  text-shadow: 0 0 20px rgba(240, 192, 64, 0.3);
}

.victory-round-badge {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 24px;
  letter-spacing: 1px;
}

/* --- Player results --- */
.victory-players {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.victory-player {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px 14px;
  text-align: left;
}

.victory-player.is-winner {
  background: rgba(240, 192, 64, 0.06);
  border-color: rgba(240, 192, 64, 0.2);
}

.vp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.vp-rank {
  font-size: 18px;
}

.vp-name {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.victory-player.is-winner .vp-name {
  color: #f0c040;
}

.vp-gold {
  font-size: 13px;
  color: #eab308;
  font-weight: 500;
}

.vp-cities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vp-city {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
}

.vp-city.city-dead {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(255, 60, 60, 0.15);
  opacity: 0.5;
}

.vp-city-name {
  color: rgba(255, 255, 255, 0.65);
}

.vp-city.city-dead .vp-city-name {
  color: #94a3b8;
  text-decoration: line-through;
}

.vp-city-hp {
  color: #60a5fa;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.vp-city.city-dead .vp-city-hp {
  color: #ef4444;
}

.vp-skills {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.vp-skills-title {
  font-size: 11px;
  color: rgba(255, 215, 0, 0.7);
  margin-bottom: 4px;
}

.vp-skills-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.vp-skill-item {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

/* --- Action buttons --- */
.victory-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.victory-btn {
  padding: 10px 28px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.victory-btn--restart {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  color: white;
}

.victory-btn--restart:hover {
  background: linear-gradient(135deg, #60a5fa, #3b82f6);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
}

.victory-btn--exit {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.victory-btn--exit:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
}

/* 战斗等待界面 */
.game-waiting-area {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 40px;
  background: linear-gradient(150deg, #2a2340 0%, #1e2a4a 30%, #2a3a5c 60%, #3a2a4a 100%);
  position: relative;
  z-index: 1;
}

.waiting-content {
  max-width: 900px;
  width: 100%;
  text-align: center;
}

.waiting-icon {
  font-size: 80px;
  margin-bottom: 30px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

.waiting-content h3 {
  font-size: 28px;
  color: #f0c850;
  margin-bottom: 15px;
  font-weight: 700;
}

.waiting-hint {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 30px;
}

/* 游戏主界面布局（带固定日志面板） - 已移除 */
.game-with-log-layout {
  display: grid;
  grid-template-columns: 1fr 500px;
  gap: 20px;
  height: 100vh;
  height: 100dvh;
  padding: 20px;
  background: linear-gradient(150deg, #2a2340 0%, #1e2a4a 30%, #2a3a5c 60%, #3a2a4a 100%);
  overflow: hidden;
  transition: grid-template-columns 0.3s ease;
  position: relative;
  z-index: 1;
}

.game-with-log-layout:has(.collapsed) {
  grid-template-columns: 1fr 60px;
}

.game-main-area {
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: 16px;
  min-width: 0;
}

.game-log-area {
  height: 100%;
  overflow: hidden;
  position: relative;
  z-index: 50;
}

/* 自定义滚动条 */
.game-main-area::-webkit-scrollbar {
  width: 10px;
}

.game-main-area::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 5px;
}

.game-main-area::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%);
  border-radius: 5px;
}

.game-main-area::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
}

/* 响应式布局 */
@media (max-width: 1400px) {
  .game-with-log-layout {
    grid-template-columns: 1fr 400px;
  }

  .game-with-log-layout:has(.collapsed) {
    grid-template-columns: 1fr 60px;
  }
}

@media (max-width: 1024px) {
  .game-with-log-layout {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 300px;
  }

  .game-with-log-layout:has(.collapsed) {
    grid-template-rows: 1fr 60px;
  }
}

@media (max-width: 768px) {
  .game-with-log-layout {
    padding: 10px;
    gap: 10px;
    grid-template-rows: 1fr 250px;
  }

  .game-with-log-layout:has(.collapsed) {
    grid-template-rows: 1fr 60px;
  }
}

/* 技能失败弹窗样式 */
.skill-failure-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(20, 30, 45, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: fadeIn 0.2s ease-out;
}

.skill-failure-content {
  background: linear-gradient(135deg, #2a2340 0%, #1e2a4a 100%);
  border-radius: 20px;
  padding: 0;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 60px rgba(100, 116, 145, 0.15);
  animation: slideUp 0.3s ease-out;
  border: 2px solid rgba(239, 68, 68, 0.3);
  overflow: hidden;
}

.skill-failure-header {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  padding: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 2px solid rgba(239, 68, 68, 0.15);
}

.skill-failure-icon {
  font-size: 48px;
  line-height: 1;
  animation: shake 0.5s ease-in-out;
}

.skill-failure-title {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  color: white;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
}

.skill-failure-body {
  padding: 32px;
  background: rgba(255, 255, 255, 0.04);
}

.skill-failure-skill,
.skill-failure-reason {
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skill-failure-skill:last-child,
.skill-failure-reason:last-child {
  margin-bottom: 0;
}

.skill-failure-skill .label,
.skill-failure-reason .label {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.skill-failure-skill .value {
  font-size: 24px;
  font-weight: 700;
  color: #fbbf24;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.skill-failure-reason .value {
  font-size: 18px;
  font-weight: 600;
  color: #fca5a5;
  line-height: 1.6;
  padding: 16px;
  background: rgba(239, 68, 68, 0.1);
  border-left: 4px solid #ef4444;
  border-radius: 8px;
}

.skill-failure-footer {
  padding: 24px 32px;
  display: flex;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
}

.skill-failure-btn {
  padding: 14px 48px;
  font-size: 18px;
  font-weight: 700;
  color: white;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.skill-failure-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
}

.skill-failure-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
  20%, 40%, 60%, 80% { transform: translateX(5px); }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* 选择新中心城市弹窗 */
.new-center-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(20, 30, 45, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  animation: fadeIn 0.2s ease-out;
}

.new-center-content {
  background: linear-gradient(135deg, #2a2340 0%, #1e2a4a 100%);
  border-radius: 20px;
  padding: 32px;
  width: 90%;
  max-width: 600px;
  box-shadow: 0 20px 60px rgba(100, 116, 145, 0.15);
  animation: slideUp 0.3s ease-out;
  border: 2px solid rgba(234, 179, 8, 0.4);
}

.new-center-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.new-center-icon {
  font-size: 36px;
}

.new-center-title {
  margin: 0;
  font-size: 24px;
  color: #fbbf24;
  font-weight: 700;
}

.new-center-reason {
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 24px;
  font-size: 14px;
  line-height: 1.6;
}

.new-center-cities {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
  max-height: 300px;
  overflow-y: auto;
}

.new-center-city-card {
  background: rgba(255, 255, 255, 0.06);
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
}

.new-center-city-card:hover {
  border-color: rgba(234, 179, 8, 0.5);
  background: rgba(234, 179, 8, 0.1);
}

.new-center-city-card.selected {
  border-color: #fbbf24;
  background: rgba(234, 179, 8, 0.2);
  box-shadow: 0 0 12px rgba(234, 179, 8, 0.3);
}

.new-center-city-hp {
  margin-top: 8px;
  font-size: 13px;
  color: #94a3b8;
}

.new-center-confirm-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.new-center-confirm-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
}

.new-center-confirm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ========== 无懈可击等待遮罩 ========== */
.intercept-waiting-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.intercept-waiting-content {
  text-align: center;
  padding: 40px;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border: 2px solid rgba(139, 92, 246, 0.4);
  border-radius: 16px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(139, 92, 246, 0.3);
}

.intercept-waiting-content .waiting-icon {
  font-size: 48px;
  margin-bottom: 16px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
}

.intercept-waiting-content h3 {
  color: #c4b5fd;
  font-size: 20px;
  margin: 0 0 12px 0;
}

.intercept-waiting-content .waiting-hint {
  color: #94a3b8;
  font-size: 14px;
  margin: 0 0 20px 0;
}

.waiting-progress-bar {
  height: 6px;
  background: rgba(139, 92, 246, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.waiting-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #8b5cf6, #a78bfa);
  border-radius: 3px;
  transition: width 1s linear;
}

/* 移动端渲染优化 */
@media (max-width: 768px) {
  #playerMode::before,
  #playerMode::after {
    display: none;
  }

  .game-waiting-area {
    padding: 20px;
  }

  .waiting-icon {
    font-size: 48px;
    margin-bottom: 16px;
  }

  .waiting-content h3 {
    font-size: 20px;
  }
}
</style>
