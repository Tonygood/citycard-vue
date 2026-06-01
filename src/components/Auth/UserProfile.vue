<template>
  <div class="auth-container">
    <div class="profile-form">
      <!-- Profile header -->
      <div class="profile-header">
        <div class="avatar-circle">
          {{ avatarInitial }}
        </div>
        <h2 class="profile-name">{{ authStore.displayName || '未设置昵称' }}</h2>
        <p class="profile-info">
          {{ authStore.user?.email || authStore.user?.phoneNumber || '' }}
        </p>
      </div>

      <!-- Profile fields -->
      <div class="profile-fields">
        <div class="field-row">
          <span class="field-label">昵称</span>
          <div v-if="!editMode" class="field-value-row">
            <span class="field-value">{{ authStore.displayName || '未设置' }}</span>
            <button class="field-btn" @click="startEdit">编辑</button>
          </div>
          <div v-else class="field-edit-row">
            <input
              v-model="editedNickname"
              type="text"
              class="edit-input"
              placeholder="2-20个字符"
              maxlength="20"
              @keyup.enter="saveNickname"
            />
            <button class="field-btn save" @click="saveNickname">保存</button>
            <button class="field-btn cancel" @click="cancelEdit">取消</button>
          </div>
        </div>

        <div v-if="authStore.user?.email" class="field-row">
          <span class="field-label">邮箱</span>
          <span class="field-value">{{ authStore.user.email }}</span>
        </div>

        <div v-if="authStore.user?.phoneNumber" class="field-row">
          <span class="field-label">手机号</span>
          <span class="field-value">{{ authStore.user.phoneNumber }}</span>
        </div>
      </div>

      <!-- Messages -->
      <div v-if="errorMsg" class="message error">{{ errorMsg }}</div>
      <div v-if="successMsg" class="message success">{{ successMsg }}</div>

      <!-- Actions -->
      <div class="profile-actions">
        <button class="action-btn back" @click="$emit('back')">返回主菜单</button>
        <button class="action-btn logout" :disabled="loading" @click="handleLogout">
          {{ loading ? '退出中...' : '退出登录' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '../../stores/authStore'
import { useAuthFunctions } from '../../composables/useAuth'

const emit = defineEmits(['back', 'logout'])

const authStore = useAuthStore()
const { updateDisplayName, logout } = useAuthFunctions()

const editMode = ref(false)
const editedNickname = ref('')
const errorMsg = ref('')
const successMsg = ref('')
const loading = ref(false)

const avatarInitial = computed(() => {
  const name = authStore.displayName
  return name ? name.charAt(0).toUpperCase() : '?'
})

function startEdit() {
  editMode.value = true
  editedNickname.value = authStore.displayName || ''
}

function cancelEdit() {
  editMode.value = false
  editedNickname.value = ''
}

async function saveNickname() {
  const trimmed = editedNickname.value.trim()
  if (trimmed.length < 2 || trimmed.length > 20) {
    errorMsg.value = '昵称长度需要在2-20个字符之间'
    return
  }
  errorMsg.value = ''
  successMsg.value = ''
  try {
    await updateDisplayName(trimmed)
    editMode.value = false
    successMsg.value = '昵称已更新'
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function handleLogout() {
  loading.value = true
  try {
    await logout()
    emit('logout')
    emit('back')
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(150deg, #2a2340 0%, #1e2a4a 30%, #2a3a5c 60%, #3a2a4a 100%);
  padding: 20px;
}

.profile-form {
  width: 100%;
  max-width: 420px;
  background: rgba(20, 25, 40, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(212, 160, 23, 0.2);
  border-radius: 20px;
  padding: 40px 32px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.profile-header {
  text-align: center;
  margin-bottom: 32px;
}

.avatar-circle {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, #d4a017 0%, #b8860b 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 800;
  color: white;
  margin: 0 auto 12px;
  box-shadow: 0 4px 16px rgba(212, 160, 23, 0.3);
}

.profile-name {
  font-size: 24px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  margin: 0 0 4px 0;
}

.profile-info {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
  margin: 0;
}

.profile-fields {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.field-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}

.field-value {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
}

.field-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-btn {
  padding: 6px 14px;
  border: 1px solid rgba(212, 160, 23, 0.3);
  border-radius: 6px;
  background: rgba(212, 160, 23, 0.1);
  color: #f0c850;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.field-btn:hover {
  background: rgba(212, 160, 23, 0.2);
}

.field-btn.save {
  border-color: rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.1);
  color: #34d399;
}

.field-btn.save:hover {
  background: rgba(52, 211, 153, 0.2);
}

.field-btn.cancel {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
}

.field-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.08);
}

.edit-input {
  flex: 1;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #e0e8ff;
  font-size: 15px;
  outline: none;
  transition: border-color 0.3s;
}

.edit-input:focus {
  border-color: rgba(212, 160, 23, 0.5);
}

.message {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 16px;
}

.message.error {
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.message.success {
  background: rgba(52, 211, 153, 0.12);
  border: 1px solid rgba(52, 211, 153, 0.3);
  color: #34d399;
}

.profile-actions {
  display: flex;
  gap: 12px;
}

.action-btn {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.action-btn.back {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.7);
}

.action-btn.back:hover {
  background: rgba(255, 255, 255, 0.1);
}

.action-btn.logout {
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.action-btn.logout:hover {
  background: rgba(248, 113, 113, 0.2);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 480px) {
  .profile-form {
    padding: 28px 20px;
  }
}
</style>
