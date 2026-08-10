import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { rm } from 'node:fs/promises'
import path from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'exclude-legacy-local-support-qr',
      async closeBundle() {
        await rm(path.resolve('dist/wechat-support.png'), { force: true })
      }
    }
  ],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
