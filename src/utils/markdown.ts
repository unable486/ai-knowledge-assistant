import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

/**
 * Markdown -> HTML 渲染链。
 *
 * 安全边界:AI 的输出本质上是不可信内容(既可能被 prompt 注入,
 * 也可能原样复述用户输入的恶意片段)。直接 v-html 渲染 markdown-it
 * 的产物是 XSS 漏洞——markdown-it 的 html:true 会放行原始 HTML 标签。
 *
 * 所以走两道:
 * 1. markdown-it 负责 Markdown 语法 -> HTML,并做代码高亮
 * 2. DOMPurify 负责剥掉 <script>、onerror= 这类可执行内容
 *
 * 顺序不能反:先净化再渲染的话,markdown-it 会把净化后的文本
 * 重新组装出新的 HTML,等于净化白做了。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const md = new MarkdownIt({
  // 放行 HTML 是为了让 AI 输出里的 <br>、<kbd> 之类能正常显示,
  // 风险由后面的 DOMPurify 兜底。
  html: true,
  linkify: true,
  breaks: true,
  highlight(code, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        // 高亮失败不该让整条消息渲染不出来,降级成纯文本
      }
    }
    return escapeHtml(code)
  }
})

// 给所有外链补 target/rel,防 reverse tabnabbing
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderMarkdown(source: string): string {
  const rawHtml = md.render(source)
  return DOMPurify.sanitize(rawHtml, {
    // 显式禁掉这几类,即使默认配置以后变了也不会放行
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onload']
  })
}
