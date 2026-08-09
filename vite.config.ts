import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // エンジン層は DOM を使わない純粋 TS のため node 環境で十分。
    // UI コンポーネントのテストを追加する Step 4 で jsdom への切り替えを検討する。
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
