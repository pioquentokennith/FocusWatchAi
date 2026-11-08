import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ['**/public/wasm/**', '**/public/models/**', '**/release/**', '**/test-results/**'] },
  },
  test: {
    environment: 'jsdom',
    clearMocks: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
})
