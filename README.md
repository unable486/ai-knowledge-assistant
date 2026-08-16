# AI 知识库助手（前端 Mock 阶段）

Vue 3 + TypeScript + Vite + Pinia 实现的 AI 对话界面。

**当前阶段是纯前端 Mock：不需要任何 API Key，不发真实网络请求。** 流式回复由本地异步生成器模拟，
目的是先把流式 UI 的交互细节（逐字输出、中途停止、失败重试、自动滚动、Markdown 安全渲染）打磨到位。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # vue-tsc --noEmit
npm run build      # 类型检查 + 生产构建
```

## 试这几件事

| 操作 | 观察什么 |
| --- | --- |
| 问「Vue 2 和 Vue 3 的响应式有什么区别？」 | 逐字流式输出、代码块高亮 |
| 生成过程中点「停止」 | 已输出的内容保留，状态变「已停止」，不是清空 |
| 输入「模拟错误」 | 错误提示 + 重试按钮，重试复用同一条消息 |
| 输入「模拟慢速」后向上滚动 | 自动滚动会暂停，滚回底部后重新跟随 |
| 窗口拖窄到 700px 以下 | 侧边栏收窄、顶栏副标题隐藏 |

## 目录结构与设计意图

```
src/
├─ types/chat.ts          领域模型
├─ mocks/mockAI.ts        流式响应模拟（异步生成器 + AbortSignal）
├─ utils/
│  ├─ markdown.ts         markdown-it + highlight.js + DOMPurify
│  └─ id.ts               ID 生成（含 crypto.randomUUID 降级）
├─ stores/chat.ts         Pinia：只管数据
├─ composables/
│  ├─ useChat.ts          请求编排：占位 → 消费流 → 收尾
│  └─ useAutoScroll.ts    贴底跟随策略
├─ components/
│  ├─ AppSidebar.vue      会话列表
│  ├─ ChatPanel.vue       消息区 + 空态引导
│  ├─ MessageBubble.vue   单条消息（含错误态、打字指示）
│  └─ MessageInput.vue    输入框（输入法保护、发送/停止切换）
└─ styles/global.css      全局样式 + Markdown 渲染样式
```

## 面试可讲的点

**1. 用状态机代替布尔标志**（`types/chat.ts`）
`MessageStatus = 'pending' | 'streaming' | 'done' | 'aborted' | 'error'`。
用 `isLoading` / `isError` 两个布尔能组合出「既加载又出错」的非法状态，联合类型从类型层面排除了它。

**2. 异步生成器模拟 SSE**（`mocks/mockAI.ts`）
`async function*` + `for await...of`，和真实 `fetch` + `ReadableStream` 的消费方式一致。
以后接真实后端只改这一个文件，`useChat.ts` 和组件都不用动 —— 面向接口编程在前端的落地。

**3. AbortController 而不是自造 cancel()**
用标准 Web API，以后能原样传给 `fetch(url, { signal })`。
`sleep()` 内部监听 `signal` 的 abort 事件，取消能在等待中途立刻生效，而不是等当前分片延迟走完。

**4. 取消不是错误**（`useChat.ts`）
`catch` 里先判断 `err instanceof DOMException && err.name === 'AbortError'`，
走 `aborted` 分支保留已输出内容；其余才算 `error`。混在一起会把用户主动停止显示成失败。

**5. XSS 防线的顺序**（`utils/markdown.ts`）
AI 输出是不可信内容。先 markdown-it 渲染成 HTML，**再** DOMPurify 净化。
顺序反了等于白做 —— 先净化的话，markdown-it 会把净化后的文本重新组装出新 HTML。
另外给外链统一补 `rel="noopener noreferrer"`，防 reverse tabnabbing。

**6. 自动滚动的贴底策略**（`useAutoScroll.ts`）
维护 `pinnedToBottom` 标志，只在贴底时跟随，用户上滚就停。
阈值取 40px 而不是 0 —— 浏览器缩放和小数像素会让严格相等判断在部分设备上永远为 false。

**7. 中文输入法保护**（`MessageInput.vue`）
监听 `compositionstart` / `compositionend`，并检查 `event.isComposing`。
不做这层，中文用户按 Enter 确认候选词时会误发消息。

**8. 竞态处理**
- `runStream` 的 `finally` 里只有 `controller.value === ac` 时才清空，防止清掉后一次请求的 controller
- 切换/新建/删除会话前先 `abort()`，否则在飞的流会继续往旧会话写数据
- `onScopeDispose(abort)` 保证组件销毁后不再往已卸载的 store 写

**9. scoped style 的边界**（`styles/global.css`）
`v-html` 插入的节点拿不到 `data-v-xxx` 属性，所以 Markdown 渲染样式必须放全局，
不能写在组件的 `<style scoped>` 里。

**10. 职责分层**
Pinia store 只做数据读写（纯粹、可单测，不需要 mock 网络），
请求编排放在 composable 里。这样「换数据源」和「改交互」互不影响。

## 下一阶段（还没做）

- 接真实模型 API：**必须走自建后端代理**。前端打包产物对用户完全可见，
  Vite 的 `VITE_` 前缀环境变量会被编译时内联进 JS，把 Key 放前端等于公开泄露。
- 会话持久化（localStorage / IndexedDB）
- 文档上传 + 向量检索（RAG）
- 长列表虚拟滚动
