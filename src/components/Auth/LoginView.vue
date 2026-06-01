<template>
  <div class="auth-container">
    <div class="auth-form">
      <div class="auth-header">
        <h1 class="auth-title">城与卡牌</h1>
        <p class="auth-subtitle">City Card Battle</p>
      </div>

      <!-- Tab switcher -->
      <div class="auth-tabs">
        <button
          :class="['tab-btn', { active: authMethod === 'email' }]"
          @click="authMethod = 'email'"
        >邮箱登录</button>
        <button
          :class="['tab-btn', { active: authMethod === 'phone' }]"
          @click="authMethod = 'phone'"
        >手机号登录</button>
      </div>

      <!-- Email login form -->
      <div v-if="authMethod === 'email'" class="form-section">
        <div class="form-group">
          <label class="form-label">邮箱地址</label>
          <input
            v-model="email"
            type="email"
            class="form-input"
            placeholder="请输入邮箱"
            @keyup.enter="handleEmailLogin"
          />
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input
            v-model="password"
            type="password"
            class="form-input"
            placeholder="请输入密码"
            @keyup.enter="handleEmailLogin"
          />
        </div>
        <button class="auth-btn" :disabled="loading" @click="handleEmailLogin">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <button class="link-btn" @click="handleResetPassword">忘记密码？</button>
      </div>

      <!-- Phone login form -->
      <div v-if="authMethod === 'phone'" class="form-section">
        <div class="form-group">
          <label class="form-label">手机号码</label>
          <div class="phone-input">
            <select v-model="countryCode" class="country-code-select">
              <option value="+86">+86 中国</option>
              <option value="+1">+1 美国/加拿大</option>
              <option value="+44">+44 英国</option>
              <option value="+81">+81 日本</option>
              <option value="+82">+82 韩国</option>
              <option value="+852">+852 香港</option>
              <option value="+853">+853 澳门</option>
              <option value="+886">+886 台湾</option>
              <option value="+65">+65 新加坡</option>
              <option value="+60">+60 马来西亚</option>
            </select>
            <input
              v-model="phoneNumber"
              type="tel"
              class="form-input"
              placeholder="请输入手机号"
            />
          </div>
        </div>

        <button
          v-if="!smsCodeSent"
          class="sms-btn"
          :disabled="loading || countdown > 0"
          @click="handleSendSms"
        >
          {{ countdown > 0 ? `${countdown}秒后重发` : '获取验证码' }}
        </button>

        <div v-if="smsCodeSent" class="form-group">
          <label class="form-label">验证码</label>
          <input
            v-model="smsCode"
            type="text"
            class="form-input"
            placeholder="请输入6位验证码"
            maxlength="6"
            @keyup.enter="handlePhoneLogin"
          />
        </div>

        <button
          v-if="smsCodeSent"
          class="auth-btn"
          :disabled="loading"
          @click="handlePhoneLogin"
        >
          {{ loading ? '验证中...' : '验证并登录' }}
        </button>
      </div>

      <!-- Error/success messages -->
      <div v-if="errorMsg" class="message error">{{ errorMsg }}</div>
      <div v-if="successMsg" class="message success">{{ successMsg }}</div>

      <!-- Navigation links -->
      <div class="auth-links">
        <button class="link-btn" @click="$emit('navigate', 'register')">没有账号？注册</button>
        <button class="link-btn" @click="$emit('back')">返回主菜单</button>
      </div>

      <!-- reCAPTCHA container (invisible) -->
      <div id="recaptcha-container"></div>
    </div>

    <!-- Nickname dialog for new phone users -->
    <div v-if="showNicknameDialog" class="nickname-overlay" @click.self="showNicknameDialog = false">
      <div class="nickname-dialog">
        <h3>设置昵称</h3>
        <p>欢迎！请为您的账号设置一个昵称：</p>
        <input
          v-model="nickname"
          type="text"
          class="form-input"
          placeholder="请输入昵称（2-20字符）"
          maxlength="20"
          @keyup.enter="handleSetNickname"
        />
        <button class="auth-btn" :disabled="!nickname.trim() || nickname.trim().length < 2" @click="handleSetNickname">
          确认
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAuthFunctions } from '../../composables/useAuth'

const emit = defineEmits(['navigate', 'back'])

const { loginWithEmail, resetPassword, sendPhoneSmsCode, confirmPhoneSmsCode, updateDisplayName } = useAuthFunctions()

const authMethod = ref('email')
const email = ref('')
const password = ref('')
const countryCode = ref('+86')
const phoneNumber = ref('')
const smsCode = ref('')
const smsCodeSent = ref(false)
const countdown = ref(0)
const errorMsg = ref('')
const successMsg = ref('')
const loading = ref(false)
const showNicknameDialog = ref(false)
const nickname = ref('')

let countdownTimer = null

async function handleEmailLogin() {
  if (!email.value || !password.value) {
    errorMsg.value = '请填写邮箱和密码'
    return
  }
  errorMsg.value = ''
  successMsg.value = ''
  loading.value = true
  try {
    await loginWithEmail(email.value, password.value)
    successMsg.value = '登录成功！'
    emit('back')
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function handleResetPassword() {
  if (!email.value) {
    errorMsg.value = '请先输入邮箱地址'
    return
  }
  errorMsg.value = ''
  try {
    await resetPassword(email.value)
    successMsg.value = '密码重置邮件已发送，请查收'
  } catch (e) {
    errorMsg.value = e.message
  }
}

async function handleSendSms() {
  if (!phoneNumber.value) {
    errorMsg.value = '请输入手机号'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    const fullPhone = countryCode.value + phoneNumber.value
    await sendPhoneSmsCode(fullPhone)
    smsCodeSent.value = true
    successMsg.value = '验证码已发送'
    startCountdown()
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

function startCountdown() {
  countdown.value = 60
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }, 1000)
}

async function handlePhoneLogin() {
  if (!smsCode.value) {
    errorMsg.value = '请输入验证码'
    return
  }
  errorMsg.value = ''
  loading.value = true
  try {
    const user = await confirmPhoneSmsCode(smsCode.value)
    // If new user (no display name), show nickname dialog
    if (!user.displayName) {
      showNicknameDialog.value = true
    } else {
      successMsg.value = '登录成功！'
      emit('back')
    }
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    loading.value = false
  }
}

async function handleSetNickname() {
  if (!nickname.value.trim() || nickname.value.trim().length < 2) return
  try {
    await updateDisplayName(nickname.value.trim())
    showNicknameDialog.value = false
    successMsg.value = '昵称设置成功！'
    emit('back')
  } catch (e) {
    errorMsg.value = e.message
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

.auth-header {
  text-align: center;
  margin-bottom: 32px;
}

.auth-title {
  font-size: 48px;
  font-weight: 900;
  background: linear-gradient(135deg, #f0c850 0%, #d4a017 40%, #e8c24a 60%, #f5d76e 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin: 0;
  filter: drop-shadow(0 0 20px rgba(212, 160, 23, 0.3));
  letter-spacing: 4px;
}

.auth-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.35);
  margin: 8px 0 0 0;
  letter-spacing: 4px;
  text-transform: uppercase;
}

.auth-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
}

.tab-btn {
  flex: 1;
  padding: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
}

.tab-btn.active {
  border-color: rgba(212, 160, 23, 0.5);
  background: rgba(212, 160, 23, 0.12);
  color: #f0c850;
  font-weight: 600;
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

.phone-input {
  display: flex;
  gap: 8px;
}

.country-code-select {
  width: 130px;
  padding: 12px 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: #e0e8ff;
  font-size: 13px;
  outline: none;
  cursor: pointer;
  flex-shrink: 0;
}

.country-code-select:focus {
  border-color: rgba(212, 160, 23, 0.5);
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

.sms-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(59, 130, 246, 0.15));
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 10px;
  color: #93c5fd;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.sms-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.4), rgba(59, 130, 246, 0.2));
}

.sms-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.message {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  margin-top: 12px;
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

.auth-links {
  display: flex;
  justify-content: space-between;
  margin-top: 20px;
}

.nickname-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.nickname-dialog {
  background: rgba(20, 25, 40, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(212, 160, 23, 0.3);
  border-radius: 16px;
  padding: 28px;
  max-width: 380px;
  width: 90%;
}

.nickname-dialog h3 {
  color: #f0c850;
  margin: 0 0 8px 0;
  font-size: 20px;
}

.nickname-dialog p {
  color: rgba(255, 255, 255, 0.6);
  margin: 0 0 16px 0;
  font-size: 14px;
}

.nickname-dialog .form-input {
  margin-bottom: 12px;
}

@media (max-width: 480px) {
  .auth-form {
    padding: 28px 20px;
  }

  .auth-title {
    font-size: 36px;
  }

  .country-code-select {
    width: 100px;
    font-size: 12px;
  }
}
</style>
