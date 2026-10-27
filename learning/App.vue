<script setup lang="ts">
import { ref } from 'vue'

type Source = { id: string; title: string; content: string }
const question = ref('')
const loading = ref(false)
const answer = ref('')
const sources = ref<Source[]>([])
const error = ref('')
// 记录本次按钮选择；即使请求生成，资料不足时后端也不会调用模型。
const requestedGeneration = ref<boolean | null>(null)
const examples = ['computed 和 watch 有什么区别？', 'ref 和 reactive 有什么区别？', '强缓存和协商缓存有什么区别？']

async function send(generate: boolean) {
  // 1. 检查输入，避免重复发送。generate 表示是否请求模型回答。
  if (loading.value) return
  const input = question.value.trim()
  if (!input || input.length > 2000) {
    error.value = '请输入问题，长度不超过 2000 个字符。'
    return
  }

  // 2. 清空上次结果，页面显示正在处理。
  loading.value = true
  answer.value = ''
  sources.value = []
  error.value = ''
  requestedGeneration.value = null

  try {
    // 3. 直接请求后端。可在这一行打断点，查看 input 和 generate。
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: input, generate })
    })

    // 4. 读取并检查 JSON；这里只接收完整结果，不处理流式事件。
    const data = await response.json()
    if (!response.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : '请求失败，请重试。')
    }
    if (typeof data?.answer !== 'string' || !Array.isArray(data.sources) ||
      !data.sources.every((source: Source) => source && typeof source.id === 'string' &&
        typeof source.title === 'string' && typeof source.content === 'string')) {
      throw new Error('服务端返回的数据格式不正确。')
    }

    // 5. 写入响应式数据，下方模板会自动显示资料与回答。
    sources.value = data.sources
    answer.value = data.answer
    requestedGeneration.value = generate
  } catch (cause) {
    // 6. 请求或解析失败时，展示错误，允许再次发送。
    error.value = cause instanceof Error ? cause.message : '请求失败，请重试。'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="learning">
    <div class="page">
      <header>
        <p class="eyebrow">关键词检索 · 单轮问答</p>
        <h1>知识问答 · 学习版</h1>
        <p class="intro">先找资料，再看回答。每次只保留一个问题的结果。</p>
      </header>

      <form @submit.prevent="send(true)">
        <label for="question">你想了解什么？</label>
        <textarea id="question" v-model="question" rows="3" maxlength="2000"
          :disabled="loading" placeholder="输入一个问题，或选择下面的示例" />
        <div class="examples" aria-label="示例问题">
          <button v-for="example in examples" :key="example" type="button" :disabled="loading"
            @click="question = example">{{ example }}</button>
        </div>
        <div class="actions">
          <button type="button" class="secondary" :disabled="loading || !question.trim()"
            @click="send(false)">只看检索</button>
          <button type="submit" class="primary" :disabled="loading || !question.trim()">查资料并回答</button>
        </div>
        <p class="hint">“只看检索”会显示匹配到的资料，无需配置模型 API。</p>
      </form>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="results" aria-live="polite" :aria-busy="loading">
        <p v-if="loading" role="status">正在处理，请稍候…</p>
        <template v-else-if="requestedGeneration !== null">
          <p v-if="!requestedGeneration" class="hint">仅检索完成，本次未调用模型。</p>
          <section aria-labelledby="sources-title">
            <h2 id="sources-title">检索到的资料</h2>
            <article v-for="(source, index) in sources" :key="source.id" class="source">
              <h3>[S{{ index + 1 }}] {{ source.title }}</h3>
              <p class="content">{{ source.content }}</p>
            </article>
            <p v-if="!sources.length" class="hint">没有找到相关资料，可以换个关键词再试。</p>
          </section>
          <section v-if="answer" class="answer" aria-labelledby="answer-title">
            <h2 id="answer-title">回答</h2>
            <p class="content">{{ answer }}</p>
          </section>
        </template>
      </div>
    </div>
  </main>
</template>

<style scoped>
:global(body) { margin: 0; }
.learning { min-height: 100vh; background: #f5f8f7; color: #203b33; font-family: "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.7; }
.page { max-width: 800px; margin: 0 auto; padding: 48px 24px 72px; }
.eyebrow { margin: 0 0 8px; color: #267563; font-size: 13px; }
h1 { margin: 0; font-size: 30px; letter-spacing: -.5px; }
.intro { margin: 10px 0 28px; color: #65746f; }
form { padding: 24px; background: #fff; border: 1px solid #dee7e2; border-radius: 16px; }
label { display: block; margin-bottom: 10px; font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; padding: 12px 14px; resize: vertical; border: 1px solid #c4d3cb; border-radius: 8px; font: inherit; color: inherit; background: #fff; }
button { padding: 10px 16px; border: 1px solid transparent; border-radius: 8px; font: inherit; font-size: 14px; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, textarea:focus-visible { outline: 3px solid #80b9a5; outline-offset: 3px; }
.examples { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.examples button { padding: 4px 8px; color: #446357; background: #f1f5f2; font-size: 12px; text-align: left; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.primary { background: #1c6d56; color: #fff; }
.secondary { background: #fff; border-color: #a9bdb2; color: #285b48; }
.hint { margin: 12px 0 0; color: #65746f; font-size: 13px; }
.error { padding: 12px 16px; border-radius: 8px; background: #fff0ed; color: #963b2c; }
.results { margin-top: 28px; }
h2 { margin: 24px 0 14px; font-size: 19px; }
h3 { margin: 0 0 8px; font-size: 15px; }
.source { margin-top: 12px; padding: 16px 20px; border-left: 3px solid #8ab49f; background: #fff; }
.content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer { margin-top: 28px; padding-top: 4px; border-top: 1px solid #d9e4dd; }
@media (max-width: 520px) { .page { padding: 28px 16px 48px; } form { padding: 18px; } h1 { font-size: 25px; } }
</style>
