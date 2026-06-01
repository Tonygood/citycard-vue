import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',              // 允许外部访问
    allowedHosts: ['.cpolar.top'] // 允许 cpolar 域名
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/main.js',
        '**/*.spec.js',
        '**/*.test.js'
      ]
    }
  }
})