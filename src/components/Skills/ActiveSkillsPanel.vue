<template>
  <div v-if="activeSkills.length > 0" class="active-skills-wrapper">
    <button class="toggle-btn" @click="collapsed = !collapsed">
      <span class="toggle-icon">⏱️</span>
      <span class="toggle-label">持续技能 ({{ activeSkills.length }})</span>
      <span class="toggle-arrow" :class="{ open: !collapsed }">▾</span>
    </button>
    <div v-if="!collapsed" class="active-skills-panel">
      <div class="skills-list">
        <div v-for="skill in activeSkills" :key="skill.skillName" class="skill-item">
          <div class="skill-title">
            <span class="skill-icon">{{ skill.icon }}</span>
            <span class="skill-name">{{ skill.skillName }}</span>
            <span
              v-if="skill.entries.length === 1 && !skill.entries[0].label"
              class="skill-rounds"
            >{{ skill.entries[0].rounds }}回合</span>
          </div>
          <div
            v-if="skill.entries.length > 1 || skill.entries[0].label"
            class="skill-entries"
          >
            <div v-for="(entry, idx) in skill.entries" :key="idx" class="skill-entry">
              <span class="entry-label">{{ entry.label }}</span>
              <span class="entry-rounds">{{ entry.rounds }}回合</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useGameStore } from '../../stores/gameStore'

const props = defineProps({
  currentPlayer: {
    type: Object,
    required: true
  }
})

const gameStore = useGameStore()
const collapsed = ref(false)

const activeSkills = computed(() => {
  if (!props.currentPlayer) return []
  const playerName = props.currentPlayer.name
  const skills = []

  // 1. 定海神针 - anchored cities with remaining rounds
  if (gameStore.anchored[playerName] && Object.keys(gameStore.anchored[playerName]).length > 0) {
    const entries = Object.entries(gameStore.anchored[playerName])
      .filter(([, rounds]) => rounds > 0)
      .map(([cityName, rounds]) => ({ label: cityName, rounds }))
    if (entries.length > 0) {
      skills.push({ skillName: '定海神针', icon: '⚓', entries })
    }
  }

  // 2. 技能保护 - skill protection with remaining rounds
  if (gameStore.skillProtection[playerName] && gameStore.skillProtection[playerName].roundsLeft > 0) {
    skills.push({
      skillName: '技能保护',
      icon: '🛡️',
      entries: [{ label: '', rounds: gameStore.skillProtection[playerName].roundsLeft }]
    })
  }

  // 3. 海市蜃楼 - center projection with remaining rounds
  if (gameStore.centerProjection[playerName] && gameStore.centerProjection[playerName].roundsLeft > 0) {
    skills.push({
      skillName: '海市蜃楼',
      icon: '🏝️',
      entries: [{ label: '', rounds: gameStore.centerProjection[playerName].roundsLeft }]
    })
  }

  // 4. 厚积薄发 - hidden growth accumulation
  if (gameStore.hjbf && gameStore.hjbf[playerName]) {
    const hjbfData = gameStore.hjbf[playerName]
    const entries = []
    if (typeof hjbfData === 'object') {
      if (hjbfData.roundsLeft !== undefined && hjbfData.roundsLeft > 0) {
        entries.push({ label: '', rounds: hjbfData.roundsLeft })
      } else {
        Object.entries(hjbfData).forEach(([cityName, data]) => {
          if (data && data.roundsLeft > 0) {
            entries.push({ label: cityName, rounds: data.roundsLeft })
          }
        })
      }
    }
    if (entries.length > 0) {
      skills.push({ skillName: '厚积薄发', icon: '📦', entries })
    }
  }

  // 5. 坚不可摧 - indestructible shield
  if (gameStore.jianbukecui[playerName] && gameStore.jianbukecui[playerName].roundsLeft > 0) {
    skills.push({
      skillName: '坚不可摧',
      icon: '🛡️',
      entries: [{ label: '', rounds: gameStore.jianbukecui[playerName].roundsLeft }]
    })
  }

  // 6. 移花接木 - stolen skills with remaining rounds
  if (gameStore.stolenSkills[playerName] && gameStore.stolenSkills[playerName].length > 0) {
    const entries = gameStore.stolenSkills[playerName]
      .filter(s => s.roundsLeft > 0)
      .map(s => ({ label: s.skillName, rounds: s.roundsLeft }))
    if (entries.length > 0) {
      skills.push({ skillName: '移花接木', icon: '🌸', entries })
    }
  }

  // 7. 不露踪迹 - stealth mode
  if (gameStore.stealth[playerName] && gameStore.stealth[playerName].roundsLeft > 0) {
    skills.push({
      skillName: '不露踪迹',
      icon: '👻',
      entries: [{ label: '', rounds: gameStore.stealth[playerName].roundsLeft }]
    })
  }

  // 8. 金币贷款 - gold loan no-income rounds
  if (gameStore.goldLoanRounds[playerName] && gameStore.goldLoanRounds[playerName] > 0) {
    skills.push({
      skillName: '金币贷款',
      icon: '🏦',
      entries: [{ label: '', rounds: gameStore.goldLoanRounds[playerName] }]
    })
  }

  // 9. 城市试炼 - city trial field with remaining rounds
  if (gameStore.cityTrialField && gameStore.cityTrialField[playerName]) {
    const entries = Object.entries(gameStore.cityTrialField[playerName])
      .filter(([, data]) => {
        if (!data) return false
        const remaining = data.startRound !== undefined
          ? data.startRound + data.roundsLeft - gameStore.currentRound
          : data.roundsLeft
        return remaining > 0
      })
      .map(([cityName, data]) => {
        const remaining = data.startRound !== undefined
          ? data.startRound + data.roundsLeft - gameStore.currentRound
          : data.roundsLeft
        return { label: cityName, rounds: Math.max(0, remaining) }
      })
    if (entries.length > 0) {
      skills.push({ skillName: '城市试炼', icon: '⚔️', entries })
    }
  }

  // 10. 金融危机 - global financial crisis
  if (gameStore.financialCrisis && gameStore.financialCrisis.roundsLeft > 0) {
    skills.push({
      skillName: '金融危机',
      icon: '💸',
      entries: [{ label: '', rounds: gameStore.financialCrisis.roundsLeft }]
    })
  }

  // === Opponent-affecting skills ===
  const allPlayers = gameStore.players || []

  // 11. 定时爆破 - time bombs on opponent cities
  allPlayers.forEach(player => {
    if (player.name !== playerName && gameStore.timeBombs[player.name] && Object.keys(gameStore.timeBombs[player.name]).length > 0) {
      const entries = Object.entries(gameStore.timeBombs[player.name])
        .filter(([, countdown]) => countdown > 0)
        .map(([cityName, countdown]) => ({ label: `对手·${cityName}`, rounds: countdown }))
      if (entries.length > 0) {
        skills.push({ skillName: '定时爆破', icon: '💣', entries })
      }
    }
  })

  // 12. 寸步难行 - stare down on opponents (cast by current player)
  allPlayers.forEach(player => {
    if (player.name === playerName) return
    const sd = gameStore.stareDown[player.name]
    if (sd && sd.roundsLeft > 0 && sd.caster === playerName) {
      skills.push({
        skillName: '寸步难行',
        icon: '🚫',
        entries: [{ label: `对手·${player.name}`, rounds: sd.roundsLeft }]
      })
    }
  })

  // 13. 电磁感应 - electromagnetic link on opponents (cast by current player)
  allPlayers.forEach(player => {
    if (player.name === playerName) return
    const em = gameStore.electromagnetic[player.name]
    if (em && em.roundsLeft > 0 && em.source === playerName) {
      skills.push({
        skillName: '电磁感应',
        icon: '⚡',
        entries: [{ label: `对手·${player.name}`, rounds: em.roundsLeft }]
      })
    }
  })

  // 14. 天灾人祸 - disaster on opponent cities
  allPlayers.forEach(player => {
    if (player.name !== playerName && gameStore.disaster[player.name] && Object.keys(gameStore.disaster[player.name]).length > 0) {
      const entries = Object.entries(gameStore.disaster[player.name])
        .filter(([, roundsLeft]) => roundsLeft > 0)
        .map(([cityName, roundsLeft]) => ({ label: `对手·${cityName}`, rounds: roundsLeft }))
      if (entries.length > 0) {
        skills.push({ skillName: '天灾人祸', icon: '⚡', entries })
      }
    }
  })

  // 15. 高级治疗 - banned cities (healing away)
  if (gameStore.bannedCities[playerName] && Object.keys(gameStore.bannedCities[playerName]).length > 0) {
    const entries = Object.entries(gameStore.bannedCities[playerName])
      .filter(([, rounds]) => rounds > 0)
      .map(([cityName, rounds]) => ({ label: cityName, rounds }))
    if (entries.length > 0) {
      skills.push({ skillName: '高级治疗', icon: '💊', entries })
    }
  }

  // 16. 避而不见 - forced bench on opponent cities
  allPlayers.forEach(player => {
    if (player.name !== playerName && gameStore.forcedBench && gameStore.forcedBench[player.name] && Object.keys(gameStore.forcedBench[player.name]).length > 0) {
      const entries = Object.entries(gameStore.forcedBench[player.name])
        .filter(([, rounds]) => rounds > 0)
        .map(([cityName, rounds]) => ({ label: `对手·${cityName}`, rounds }))
      if (entries.length > 0) {
        skills.push({ skillName: '避而不见', icon: '👻', entries })
      }
    }
  })

  // 17. 波涛汹涌 - wave effect on opponents
  allPlayers.forEach(player => {
    if (player.name === playerName) return
    const btxy = gameStore.botaoxiongyong && gameStore.botaoxiongyong[player.name]
    if (btxy && btxy.roundsLeft > 0) {
      skills.push({
        skillName: '波涛汹涌',
        icon: '🌊',
        entries: [{ label: `对手·${player.name}`, rounds: btxy.roundsLeft }]
      })
    }
  })

  return skills
})
</script>

<style scoped>
.active-skills-wrapper {
  margin-left: auto;
  position: relative;
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: #648cff26;
  border: 1px solid rgba(100, 140, 255, 0.3);
  border-radius: 8px;
  color: #a0c0ff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.toggle-btn:hover {
  background: #648cff40;
}

.toggle-arrow {
  transition: transform 0.2s;
}

.toggle-arrow.open {
  transform: rotate(180deg);
}

.active-skills-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 220px;
  background: #141928f2;
  border: 1px solid rgba(100, 140, 255, 0.3);
  border-radius: 10px;
  padding: 10px 12px;
  z-index: 200;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 16px #0006;
  color: #e0e8ff;
  font-size: 13px;
  max-height: 40vh;
  overflow-y: auto;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skill-item {
  padding: 4px 0;
}

.skill-item + .skill-item {
  border-top: 1px solid rgba(100, 140, 255, 0.1);
  padding-top: 6px;
}

.skill-title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skill-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.skill-name {
  font-weight: 500;
  color: #c8d8ff;
}

.skill-rounds {
  margin-left: auto;
  color: #80c0ff;
  font-size: 12px;
  white-space: nowrap;
}

.skill-entries {
  margin-top: 2px;
  padding-left: 20px;
}

.skill-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  padding: 1px 0;
  color: #a0b8d8;
}

.entry-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.entry-rounds {
  color: #80c0ff;
  white-space: nowrap;
  margin-left: 6px;
}

.active-skills-panel::-webkit-scrollbar {
  width: 4px;
}

.active-skills-panel::-webkit-scrollbar-track {
  background: transparent;
}

.active-skills-panel::-webkit-scrollbar-thumb {
  background: #648cff4d;
  border-radius: 2px;
}
</style>
