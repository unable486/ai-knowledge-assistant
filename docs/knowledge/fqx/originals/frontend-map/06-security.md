# 前端 > Web 安全与部署 > 资料说明

来源：https://fqx.lx.ci/frontend-map/

来源：https://fqx.lx.ci/frontend-map/

主线对齐 2026 年的实际工程状况：Vite 6+ / Vue 3.5+ / React 19 / TypeScript 5.7+。INP 已取代 FID，X-XSS-Protection 已废弃，涉及版本差异处单独标注。

# 前端 > Web 安全与部署

来源：https://fqx.lx.ci/frontend-map/

安全的核心思路只有一条：**永远不信任输入，也不信任输出的去处**。XSS 是「数据被当成代码执行」，CSRF 是「浏览器自动带凭证」，两者的防御方向完全不同——搞混了会做出「加了 token 却还有 XSS」这种半成品。

# 前端 > Web 安全与部署 > XSS：数据被当成代码执行

来源：https://fqx.lx.ci/frontend-map/

**三种类型，防御位置不同**：

| 类型 | 恶意代码存在哪 | 触发方式 |
|---|---|---|
| **存储型** | 服务端数据库 | 别人访问页面就中招，危害最大 |
| **反射型** | URL 参数 | 需要诱导点击特制链接 |
| **DOM 型** | 不经过服务端，纯前端 | `location.hash` 等直接进 `innerHTML` |

**DOM 型 XSS 是前端框架时代的主要形态**，因为它绕过了所有服务端过滤：

```js
// ✗ hash 里的内容直接变成 HTML
document.getElementById('tip').innerHTML = location.hash.slice(1);
// 攻击 URL: /page#<img src=x onerror=alert(document.cookie)>
```

**防御的核心是「按输出位置选转义方式」**，不是「过滤输入」：

```js
el.textContent = data;              // ✓ HTML 文本位置：自动转义，最安全
el.setAttribute('href', url);       // 需要校验协议，防 javascript:
element.style.color = color;        // CSS 位置有自己的转义规则
// URL 参数位置用 encodeURIComponent
```

**框架的自动转义能挡住大部分，但有明确的逃生口**：

```jsx
// React
<div dangerouslySetInnerHTML={{__html: html}} />    // 名字故意起得可怕
```
```vue
<!-- Vue -->
<div v-html="html"></div>
```

**要渲染富文本时唯一正确做法是 sanitize**，用 DOMPurify（不要自己写正则过滤，绕过方式多到数不清）：

```js
import DOMPurify from 'dompurify';
el.innerHTML = DOMPurify.sanitize(userHtml, {
  ALLOWED_TAGS: ['b', 'i', 'p', 'a'],
  ALLOWED_ATTR: ['href'],
});
```

**`href` 的协议校验容易漏**：

```js
// ✗ <a href="javascript:alert(1)">点我</a> 也是 XSS
<a href={userUrl}>link</a>

// ✓ 白名单协议
const safe = /^(https?:|mailto:|\/)/.test(userUrl) ? userUrl : '#';
```

**CSP 是纵深防御的第二道**，即使有 XSS 也能限制危害：

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{随机值}';
  object-src 'none';
  base-uri 'self';
```

**用 nonce 或 hash，不要用 `unsafe-inline`**——加了 `unsafe-inline` 的 CSP 对 XSS 基本没有防护效果。`base-uri 'self'` 常被遗漏，但它能挡住通过 `<base>` 标签劫持所有相对路径的攻击。

# 前端 > Web 安全与部署 > CSRF：浏览器自动带凭证

来源：https://fqx.lx.ci/frontend-map/

**原理**：攻击者的页面向你的站点发请求，浏览器会**自动带上 cookie**，服务端以为是用户本人操作。

```html
<!-- 攻击者页面。用户已登录 bank.com 的话，这个转账会成功 -->
<form action="https://bank.com/transfer" method="POST">
  <input name="to" value="attacker"><input name="amount" value="10000">
</form>
<script>document.forms[0].submit()</script>
```

**关键区别**：CSRF 不需要读响应（同源策略挡着），它只要**这个请求发出去并被执行**就够了。所以「我用了 CORS 所以不怕 CSRF」是错的——CORS 限制的是读响应，不是发请求。

**四道防御，按性价比排**：

**1. `SameSite` Cookie（最省事，现代浏览器默认）**

```
Set-Cookie: session=x; SameSite=Lax; Secure; HttpOnly
```

- `Strict` —— 任何跨站请求都不带（连从别的站点点链接进来都不带，登录态会丢，体验差）
- `Lax` —— 顶级导航的 GET 带，POST 和子资源不带（**默认值，多数场景够用**）
- `None` —— 都带，必须同时 `Secure`（第三方嵌入场景才用）

**2. CSRF Token**——服务端生成随机 token 放表单/请求头，校验时对比 session 里的值。攻击者跨站拿不到这个 token。

**3. Double Submit Cookie**——token 同时放 cookie 和请求头，服务端比对两者是否一致。无状态，不需要服务端存 token。

**4. 校验 `Origin` / `Referer`**——作为辅助手段，不能单独依赖（Referer 可能被隐私设置去掉）。

**HttpOnly 防的是 XSS 不是 CSRF**——它让 JS 读不到 cookie，但浏览器发请求时照样自动带。这两个属性各管一头，经常被混。

**JWT 放哪里的权衡**：
- **放 localStorage** —— 不受 CSRF 影响（不自动带），但**XSS 能直接读走**
- **放 HttpOnly Cookie** —— XSS 读不到，但需要防 CSRF

**没有免费方案**。实践上推荐：短时效 access token 放内存（不落地），refresh token 放 `HttpOnly; SameSite=Lax` Cookie，配 CSRF token。

# 前端 > Web 安全与部署 > AI 应用前端的新攻击面

来源：https://fqx.lx.ci/frontend-map/

这块是传统前端安全清单里没有的，但正在变成面试重点。

**1. 把 LLM 输出直接 `innerHTML` 是新的 XSS 入口**

模型输出是**不可信数据**，和用户输入同级。如果模型被提示注入诱导，它会输出你不想要的 HTML：

```js
// ✗ 模型输出 Markdown，你渲染成 HTML —— 注入点
el.innerHTML = marked(llmResponse);

// ✓ 渲染后必须 sanitize
el.innerHTML = DOMPurify.sanitize(marked(llmResponse));
```

**这个坑的隐蔽性在于**：正常测试时模型不会输出恶意内容，只有被注入时才会。所以功能测试全过，安全问题仍在。

**2. 流式响应的渲染安全**

SSE 流式输出时，内容是逐块拼接的。**不能对未完成的片段做 sanitize 后拼接**——一个被截断的 `<img src=x onerror=` 可能在下一块拼完后变成完整的攻击载荷。正确做法是先累积完整文本，再整体 sanitize 渲染。

**3. 提示注入不是「前端能防住的」**

用户上传的文档、抓取的网页、别的用户的输入，都可能包含「忽略之前的指令」这类内容。**前端能做的是限制影响面**：
- 模型输出的链接要校验协议和域名白名单
- 模型触发的操作（跳转、下载、调 API）要有确认步骤，不能自动执行
- 展示时明确标注「以下内容来自外部来源」

**4. API Key 绝不能进前端**

```js
// ✗ 打包后任何人都能从 bundle 里搜出来
const openai = new OpenAI({ apiKey: 'sk-...' });
```

**`VITE_` / `NEXT_PUBLIC_` 前缀的环境变量是公开的**——这是设计如此，不是漏洞。必须走自己的后端代理，key 留在服务端。

**5. 用量和成本的前端防护是无效的**

前端做的速率限制可以被绕过（改 JS、直接调 API）。**真正的限流必须在服务端**。前端的防抖只是改善体验，不是安全措施。

# 前端 > Web 安全与部署 > 部署与上线

来源：https://fqx.lx.ci/frontend-map/

**静态资源部署的标准形态**：

```nginx
# HTML 不缓存，保证能拿到新版本
location = /index.html {
    add_header Cache-Control "no-cache";
}

# 带哈希的资源长缓存
location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# SPA 路由回落 —— 刷新 /some/route 时服务器上没这文件，交给前端路由
location / {
    try_files $uri $uri/ /index.html;
}
```

**`try_files` 回落的一个真实坑**：它会让**不存在的图片和 API 也返回 200 + HTML**。`<img>` 拿到一坨 HTML 只显示裂图，排查时以为图片丢了。所以静态资源目录的 location 要写在 SPA 回落**之前**，并且用 `try_files $uri =404`。

**上线必备的安全响应头**：

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY                      # 或 CSP 的 frame-ancestors
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=()
```

**`X-XSS-Protection` 已废弃**，现代浏览器移除了它，写了也没用。提它会显得知识过期。

**灰度发布的前端难点**：用户可能在版本切换期间加载了新的 HTML 但旧的 chunk（或反之），导致 `Loading chunk failed`。

**三种处理**：
1. **保留旧版本资源**——新版上线不删旧 chunk，至少留几个版本
2. **捕获加载失败后刷新**——`import()` 的 catch 里提示用户刷新
3. **版本检测**——轮询一个版本号文件，发现更新提示用户刷新

第 2 条最常见：

```js
const Page = lazy(() =>
  import('./Page').catch(() => {
    location.reload();               // chunk 加载失败，大概率是版本切换
    return { default: () => null };
  })
);
```

**Source map 的处理**：
- **不要传到公网**——泄露源码
- 传到错误监控平台（Sentry）用于还原堆栈
- 构建时用 `hidden-source-map`：生成但不在 bundle 里写引用注释

**监控三件套**：错误上报（Sentry）、性能上报（web-vitals + RUM）、用户行为回放（可选，注意隐私合规）。**没有监控的上线等于闭眼开车**——面试问「你怎么知道优化生效了」，答案必须是数据而不是感觉。
