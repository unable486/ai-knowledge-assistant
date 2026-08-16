/// <reference types="vite/client" />

// 让 TypeScript 认识 .vue 单文件组件的默认导出
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
