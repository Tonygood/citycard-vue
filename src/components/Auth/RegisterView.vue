<template>
  <div class="auth-container">
    <div class="auth-form">
      <button class="back-btn" @click="$emit('navigate', 'login')">← 返回登录</button>

      <div class="auth-header">
        <h2 class="register-title">创建账号</h2>
      </div>

      <div class="form-section">
        <div class="form-group">
          <label class="form-label">昵称</label>
          <input
            v-model="nickname"
            type="text"
            class="form-input"
            placeholder="2-20个字符"
            maxlength="20"
          />
          <span v-if="nickname && (nickname.length < 2 || nickname.length > 20)" class="validation-hint">
            昵称长度需要在2-20个字符之间
          </span>
        </div>

        <div class="form-group">
          <label class="form-label">邮箱地址</label>
          <input
            v-model="email"
            type="email"
            class="form-input"
            placeholder="请输入邮箱"
          />
        </div>

        <div class="form-group">
          <label class="form-label">密码</label>
          <input
            v-model="password"
            type="password"
            class="form-input"
            placeholder="至少6位字符"
          />
          <div v-if="password" class="password-strength">
            <div
              class="strength-bar"
              :style="{ width: passwordStrength + '%', backgroundColor: strengthColor }"
            ></div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">确认密码</label>
          <input
            v-model="confirmPassword"
            type="password"
            class="form-input"
            placeholder="再次输入密码"
            @keyup.enter="handleRegister"
          />
          <span v-if="confirmPassword && password !== confirmPassword" class="validation-hint">
            两次输入的密码不一致
          </span>
        </div>

        <button
          class="auth-btn"
          :disabled="loading || !isFormValid"
          @click="handleRegister"
        >
          {{ loading ? '注册中...' : '创建账号' }}
        </button>
      </div>

      <div v-if="errorMsg" class="message error">{{ errorMsg }}</div>

      <div class="auth-links">
        <button class="link-btn" @click="$emit('navigate', 'login')">已有账号？登录</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useAuthFunctions } from '../../composables/useAuth'

const emit = defineEmits(['navigate'])

const { registerWithEmail } = useAuthFunctions()

const nickname = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

const passwordStrength = computed(() => {
  const p = password.value
  if (!p) return 0
  let score = 0
  if (p.length >= 6) score += 25
  if (p.length >= 8) score += 15
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 20
  if (/\d/.test(p)) score += 20
  if (/[^a-zA-Z0-9]/.test(p)) score += 20
  return Math.min(100, score)
})

const strengthColor = computed(() => {
  const s = passwordStrength.value
  if (s < 30) return '#f87171'
  if (s < 60) return '#fbbf24'
  return '#34d399'
})

const isFormValid = computed(() => {
  return nickname.value.length >= 2 &&
    nickname.value.length <= 20 &&
    email.value.includes('@') &&
    password.value.length >= 6 &&
    password.value === confirmPassword.value
})

async function handleRegister() {
  if (!isFormValid.value) return
  errorMsg.value = ''
  loading.value = true
  try {
    await registerWithEmail(email.value, password.value, nickname.value)
    emit('navigate', 'menu')
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

.auth-form {
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

.back-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  margin-bottom: 16px;
  transition: color 0.2s;
}

.back-btn:hover {
  color: rgba(255, 255, 255, 0.8);
}

.auth-header {
  text-align: center;
  margin-bottom: 28px;
}

.register-title {
  font-size: 28px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.9);
  margin: 0;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 600;
}

.form-input {
  width: 100%;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: #e0e8ff;
  font-size: 15px;
  outline: none;
  transition: border-color 0.3s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: rgba(212, 160, 23, 0.5);
}

.form-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.validation-hint {
  font-size: 12px;
  color: #f87171;
}

.password-strength {
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.strength-bar {
  height: 100%;
  border-radius: 2px;
  transition: all 0.3s;
}

.auth-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #d4a017 0%, #b8860b 100%);
  border: none;
  border-radius: 10px;
  color: white;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 14px rgba(212, 160, 23, 0.3);
}

.auth-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(212, 160, 23, 0.4);
}

.auth-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.message.error {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 12px;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f87171;
}

.auth-links {
  text-align: center;
  margin-top: 20px;
}

.link-btn {
  background: none;
  border: none;
  color: rgba(212, 160, 23, 0.7);
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.2s;
}

.link-btn:hover {
  color: #f0c850;
}

@media (max-width: 480px) {
  .auth-form {
    padding: 28px 20px;
  }
}
</style>
