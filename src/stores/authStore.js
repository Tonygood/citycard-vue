import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const authReady = ref(false)
  const loading = ref(false)

  const isLoggedIn = computed(() => !!user.value)
  const displayName = computed(() => user.value?.displayName || '')
  const uid = computed(() => user.value?.uid || '')

  function setUser(firebaseUser) {
    if (firebaseUser) {
      user.value = {
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || '',
        phoneNumber: firebaseUser.phoneNumber || ''
      }
    } else {
      user.value = null
    }
  }

  function clearUser() {
    user.value = null
  }

  function setAuthReady(value) {
    authReady.value = value
  }

  function setLoading(value) {
    loading.value = value
  }

  return {
    user,
    authReady,
    loading,
    isLoggedIn,
    displayName,
    uid,
    setUser,
    clearUser,
    setAuthReady,
    setLoading
  }
})
