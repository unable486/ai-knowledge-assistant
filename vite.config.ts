import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 纯前端项目,不需要代理后端接口(第一阶段用Mock数据)
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173
  }
})
