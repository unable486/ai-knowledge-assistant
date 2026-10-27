export interface KnowledgeItem {
  id: string
  title: string
  keywords: string[]
  content: string
}

// 学习版把知识写在这里：每个对象就是一段可以交给模型参考的资料。
const knowledgeItems: KnowledgeItem[] = [
  {
    id: 'vue-computed-watch',
    title: 'computed、watch 和 watchEffect',
    keywords: ['computed', 'watch', 'watcheffect', '计算属性', '侦听器'],
    content: 'computed 用于声明派生值，会缓存结果，依赖变化后在下次读取时重新计算。watch 显式指定要监听的数据，适合请求接口等副作用，并能拿到新旧值。watchEffect 会立即执行，并自动追踪同步执行期间读取的响应式依赖。',
  },
  {
    id: 'vue-reactivity',
    title: 'ref 和 reactive',
    keywords: ['ref', 'reactive', '响应式'],
    content: 'ref 可以包装基本类型或对象，在 JavaScript 中通过 .value 读写，在模板中通常会自动解包。reactive 返回对象的响应式代理，适合组织一组相关状态；直接解构其中的基本类型属性会失去与原属性的响应式联系。',
  },
  {
    id: 'browser-cache',
    title: '浏览器的强缓存和协商缓存',
    keywords: ['强缓存', '协商缓存', '浏览器缓存', 'cache-control', 'etag'],
    content: '强缓存通过 Cache-Control 等响应头判断资源是否仍然新鲜，新鲜时可直接使用本地缓存。需要重新验证时，浏览器可用 ETag 对应的 If-None-Match 等条件请求进行协商：资源未变化返回 304，继续使用缓存正文；变化则返回新内容。',
  },
]

export function retrieve(question: string): KnowledgeItem[] {
  const query = question.toLowerCase()
  // ponytail: 仅匹配关键词，不处理同义词或指代；需要语义检索时再替换为向量检索。
  return knowledgeItems
    .map((item) => ({
      item,
      score: item.keywords.filter((keyword) => query.includes(keyword.toLowerCase())).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ item }) => item)
}
