import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  updateProfile,
  signOut
} from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { useAuthStore } from '../stores/authStore'

// Firebase error code to Chinese message mapping
const ERROR_MESSAGES = {
  'auth/email-already-in-use': '该邮箱已被注册',
  'auth/weak-password': '密码强度不够（至少6位）',
  'auth/invalid-email': '邮箱格式不正确',
  'auth/user-not-found': '账号不存在',
  'auth/wrong-password': '密码错误',
  'auth/too-many-requests': '操作过于频繁，请稍后再试',
  'auth/invalid-phone-number': '手机号格式不正确',
  'auth/invalid-verification-code': '验证码错误',
  'auth/code-expired': '验证码已过期',
  'auth/missing-phone-number': '请输入手机号',
  'auth/configuration-not-found': '手机号登录未启用，请在 Firebase Console 中开启 Phone 提供方',
  'auth/captcha-check-failed': 'reCAPTCHA 验证失败，请刷新页面重试',
  'auth/quota-exceeded': '短信配额已用完，请稍后再试或使用邮箱登录'
}

function getErrorMessage(error) {
  return ERROR_MESSAGES[error.code] || error.message || '操作失败，请重试'
}

let recaptchaVerifier = null
let confirmationResult = null

export function useAuthFunctions() {
  const authStore = useAuthStore()

  function getFirebaseAuth() {
    const apps = getApps()
    if (apps.length === 0) return null
    return getAuth(apps[0])
  }

  /**
   * Initialize auth state listener
   */
  function initAuthListener() {
    const auth = getFirebaseAuth()
    if (!auth) {
      authStore.setAuthReady(true)
      return
    }
    onAuthStateChanged(auth, (user) => {
      authStore.setUser(user)
      authStore.setAuthReady(true)
    })
  }

  /**
   * Register with email and password
   */
  async function registerWithEmail(email, password, nickname) {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase 未初始化')

    authStore.setLoading(true)
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)
      if (nickname) {
        await updateProfile(userCredential.user, { displayName: nickname })
      }
      authStore.setUser(userCredential.user)
      return userCredential.user
    } catch (error) {
      throw new Error(getErrorMessage(error))
    } finally {
      authStore.setLoading(false)
    }
  }

  /**
   * Login with email and password
   */
  async function loginWithEmail(email, password) {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase 未初始化')

    authStore.setLoading(true)
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)
      authStore.setUser(userCredential.user)
      return userCredential.user
    } catch (error) {
      throw new Error(getErrorMessage(error))
    } finally {
      authStore.setLoading(false)
    }
  }

  /**
   * Send password reset email
   */
  async function resetPassword(email) {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase 未初始化')

    try {
      await sendPasswordResetEmail(auth, email)
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Send phone SMS verification code
   */
  async function sendPhoneSmsCode(phoneNumber) {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase 未初始化')

    try {
      // Create reCAPTCHA verifier if not exists
      if (!recaptchaVerifier) {
        recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        })
      }
      confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier)
      return true
    } catch (error) {
      // Reset reCAPTCHA on failure
      recaptchaVerifier = null
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Confirm phone SMS verification code
   */
  async function confirmPhoneSmsCode(code) {
    if (!confirmationResult) throw new Error('请先获取验证码')

    authStore.setLoading(true)
    try {
      const result = await confirmationResult.confirm(code)
      authStore.setUser(result.user)
      return result.user
    } catch (error) {
      throw new Error(getErrorMessage(error))
    } finally {
      authStore.setLoading(false)
    }
  }

  /**
   * Update user display name
   */
  async function updateDisplayName(name) {
    const auth = getFirebaseAuth()
    if (!auth || !auth.currentUser) throw new Error('未登录')

    try {
      await updateProfile(auth.currentUser, { displayName: name })
      authStore.setUser(auth.currentUser)
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  /**
   * Logout
   */
  async function logout() {
    const auth = getFirebaseAuth()
    if (!auth) return

    try {
      await signOut(auth)
      authStore.clearUser()
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  }

  return {
    initAuthListener,
    registerWithEmail,
    loginWithEmail,
    resetPassword,
    sendPhoneSmsCode,
    confirmPhoneSmsCode,
    updateDisplayName,
    logout
  }
}
