import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieve } from './knowledge.ts'

test('命中关键词时返回对应资料，无关键词时返回空列表', () => {
  const hits = retrieve('computed 和 watch 应该怎么选择？')
  assert.deepEqual(hits.map((item) => item.id), ['vue-computed-watch'])
  assert.match(hits[0].content, /派生值/)
  assert.deepEqual(retrieve('今天上海天气怎么样？'), [])
  assert.deepEqual(retrieve('1'), [])
  assert.deepEqual(retrieve(''), [])
})

test('命中更多关键词的资料排在前面，最多返回两段', () => {
  const hits = retrieve('比较 computed、ref、reactive、强缓存、协商缓存和 ETag')
  assert.deepEqual(hits.map((item) => item.id), ['browser-cache', 'vue-reactivity'])
})

test('英文关键词不区分大小写', () => {
  const hits = retrieve('COMPUTED 与 Watch 怎么选？')
  assert.deepEqual(hits.map((item) => item.id), ['vue-computed-watch'])
})
