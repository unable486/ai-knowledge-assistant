# 前端 > 网络与性能优化 > 资料说明

来源：https://fqx.lx.ci/frontend-map/

来源：https://fqx.lx.ci/frontend-map/

主线对齐 2026 年的实际工程状况：Vite 6+ / Vue 3.5+ / React 19 / TypeScript 5.7+。INP 已取代 FID，X-XSS-Protection 已废弃，涉及版本差异处单独标注。

# 前端 > 网络与性能优化

来源：https://fqx.lx.ci/frontend-map/

性能优化最忌讳凭感觉。顺序应该是：**先有指标**（LCP / INP / CLS）→ **再定位瓶颈**（是网络慢、还是主线程忙、还是渲染阻塞）→ **再针对性改**。跳过前两步直接上「优化手段清单」，是面试里最容易被追问穿的地方。

# 前端 > 网络与性能优化 > Core Web Vitals：三个指标，各对应不同瓶颈

来源：https://fqx.lx.ci/frontend-map/

| 指标 | 衡量什么 | 好的阈值 | 常见病因 |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | 最大内容元素渲染完成 | ≤ 2.5s | 首屏图片没优化、CSS/JS 阻塞、服务端慢 |
| **INP** (Interaction to Next Paint) | 交互响应延迟（已取代 FID） | ≤ 200ms | 长任务占住主线程 |
| **CLS** (Cumulative Layout Shift) | 累积布局偏移 | ≤ 0.1 | 图片没写尺寸、字体切换、广告插入 |

**INP 取代 FID 是 2024 年的变化**——FID 只测「第一次交互的输入延迟」，INP 测所有交互的完整响应时间，更接近真实体感。面试提到 FID 会显得知识过期。

**针对性的修法**：

**LCP 慢**：
- 首屏图片用 `<img>` 而非 CSS 背景（能被扫描器提前发现）
- 加 `fetchpriority="high"`、`<link rel="preload">`
- **首屏图片绝不能 `loading="lazy"`**——这是个常见的自伤操作
- 用 AVIF / WebP，配 `<picture>` 降级
- 服务端 TTFB 优化（CDN、边缘渲染）

**INP 差**：
- 拆长任务，超过 50ms 的分片。用 `scheduler.postTask()` 或 `await new Promise(r => setTimeout(r))`
- 重活挪到 Web Worker
- 列表虚拟化（只渲染可见区域）
- 输入用非受控组件或防抖，避免每次按键都触发大量重渲染

**CLS 大**：
- 图片/视频写 `width`+`height`（或 `aspect-ratio`），浏览器好预留空间
- 字体用 `font-display: optional` 或 `size-adjust` 减少切换跳动
- 骨架屏尺寸要和真实内容一致
- 动态插入的内容用 `transform` 而非改变布局属性

**怎么量**：实验室数据用 Lighthouse（可复现、便于对比），真实用户数据用 `web-vitals` 库上报 + RUM。**两者会不一致**——Lighthouse 是单次模拟，真实用户有各种设备和网络。面试说「我们看 p75 的真实用户数据」比「Lighthouse 跑了 95 分」专业。

# 前端 > 网络与性能优化 > HTTP 缓存：强缓存与协商缓存

来源：https://fqx.lx.ci/frontend-map/

**两层，顺序是先强缓存再协商缓存**：

```
请求资源
  ↓
Cache-Control / Expires 还没过期？ → 是 → 直接用本地副本（不发请求，200 from disk cache）
  ↓ 否
带 If-None-Match / If-Modified-Since 发请求
  ↓
服务端说没变？ → 304 Not Modified（不传 body）
  ↓ 变了
200 + 新内容
```

**`Cache-Control` 的关键指令**：

```
max-age=31536000        本地缓存一年
no-cache                每次都要协商（不是「不缓存」！）
no-store                真的不缓存，任何地方都不存
immutable               永不变，连协商都不做（配合内容哈希用）
must-revalidate         过期后必须验证，不能用陈旧副本
private / public        能否被 CDN 等中间层缓存
stale-while-revalidate  先用旧的，后台更新
```

**`no-cache` 和 `no-store` 常被混用**——`no-cache` 是「可以存但用前必须问」，`no-store` 是「一个字节都别留」。敏感页面（含个人信息的 HTML）要用 `no-store`。

**标准的静态资源缓存策略**：

```
index.html           Cache-Control: no-cache          # 必须每次验证，否则用户永远拿不到新版本
app.a1b2c3.js        Cache-Control: max-age=31536000, immutable
logo.d4e5f6.png      Cache-Control: max-age=31536000, immutable
```

**原理是「内容哈希 + 长缓存」**：文件内容变了文件名就变，所以旧文件的长缓存不会造成问题，新文件是全新 URL 必然重新下载。**HTML 不能长缓存**，因为它是引用哈希文件名的入口。

**ETag vs Last-Modified**：ETag 是内容指纹（更准，但计算有成本，多机部署要保证一致），Last-Modified 精度只到秒（一秒内多次修改识别不出）。两者都有时 ETag 优先。

**多机部署的 ETag 坑**：nginx 默认的 ETag 基于「修改时间 + 文件大小」，不同机器上同一文件的 mtime 可能不同，导致 ETag 不一致，客户端反复拿到 200 而非 304。解法是构建时固定 mtime，或者干脆关掉 ETag 只用内容哈希文件名。

# 前端 > 网络与性能优化 > 跨域：CORS 的完整流程和坑

来源：https://fqx.lx.ci/frontend-map/

**同源 = 协议 + 域名 + 端口三者全同**。跨域限制是浏览器的行为，服务端之间互相请求没有这回事。

**简单请求 vs 预检请求**：

满足以下全部条件才是简单请求，直接发不预检：
- 方法是 `GET` / `HEAD` / `POST`
- `Content-Type` 只能是 `text/plain` / `multipart/form-data` / `application/x-www-form-urlencoded`
- 没有自定义请求头

**所以 `Content-Type: application/json` 一定触发 OPTIONS 预检**——这是最常见的「为什么多了一个 OPTIONS 请求」的答案。

```
OPTIONS /api/data
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, authorization
        ↓
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: POST, GET
Access-Control-Allow-Headers: content-type, authorization
Access-Control-Max-Age: 86400          ← 预检结果缓存一天，减少 OPTIONS
```

**带凭证（cookie）的三个硬性要求**，缺一个都失败：
1. 前端设 `credentials: 'include'`（fetch）或 `withCredentials = true`（XHR）
2. 服务端 `Access-Control-Allow-Credentials: true`
3. 服务端 `Access-Control-Allow-Origin` **必须是具体域名，不能是 `*`**

第 3 条是最常踩的——本地开发用 `*` 一切正常，加了 cookie 就报错。

**能读到的响应头默认只有七个**（CORS-safelisted）。要读自定义头必须显式暴露：

```
Access-Control-Expose-Headers: X-Total-Count, X-Request-Id
```

「分页总数拿不到」通常就是这个原因。

**解决跨域的实际手段**（按推荐度）：
1. **同源部署**——前后端在同一域名下，用路径区分。最省事，没有 CORS 问题
2. **nginx 反向代理**——前端请求 `/api/`，nginx 转发到后端
3. **正确配置 CORS**——服务端加响应头
4. **dev 用构建工具的 proxy**——Vite `server.proxy`，只解决开发环境

**JSONP 已经过时**——只支持 GET、有 XSS 风险、错误处理困难。面试提它可以，但要说明是历史方案。

# 前端 > 网络与性能优化 > 资源加载：预加载、分包与懒加载

来源：https://fqx.lx.ci/frontend-map/

**四个 `rel` 值，用途完全不同**：

```html
<link rel="preload"  href="font.woff2" as="font" crossorigin>  <!-- 当前页必需，高优先级 -->
<link rel="prefetch" href="next.js">                            <!-- 下个页面可能用，空闲时下载 -->
<link rel="preconnect" href="https://api.example.com">          <!-- 提前建 TCP+TLS 连接 -->
<link rel="dns-prefetch" href="https://cdn.example.com">        <!-- 只做 DNS 解析 -->
```

**`preload` 用错会变成负优化**——它是高优先级，抢占了真正首屏关键资源的带宽。只用于「确定当前页会用、但发现得太晚」的资源，典型是 CSS 里 `@font-face` 引用的字体（浏览器要先解析 CSS 才知道要下载字体）。

**`preload` 字体必须加 `crossorigin`**，否则会下载两次——字体请求是匿名 CORS 模式，不带 crossorigin 的 preload 和实际请求被当成两个不同的资源。

**代码分割的三个层次**：

```js
// 1. 路由级 —— 收益最大，最该先做
const Detail = lazy(() => import('./pages/Detail'));

// 2. 组件级 —— 大组件按需加载（图表、富文本编辑器、地图）
const Chart = lazy(() => import('./Chart'));

// 3. 库级 —— 手动分 vendor chunk
manualChunks: {
  vendor: ['react', 'react-dom'],
  chart: ['echarts'],
}
```

**分包的反模式**：拆得太碎。HTTP/2 虽然多路复用，但每个请求仍有开销，而且太多小文件压缩率下降。**一般单个 chunk 控制在 50-200KB（gzip 前）比较合适。**

**图片优化的优先级**：
1. **响应式图片** `srcset` + `sizes`——手机不该下 2000px 的图
2. **现代格式** AVIF > WebP > JPEG，用 `<picture>` 降级
3. **懒加载** `loading="lazy"`——但首屏图片绝不能加
4. **占位** `aspect-ratio` 或 LQIP（低质量占位图）防 CLS

**虚拟滚动的适用条件**：列表超过几百项、每项高度可预测。不适合高度差异大的内容（需要动态测量，复杂度陡增）。库选 `@tanstack/virtual` 或 `vue-virtual-scroller`。

**Web Worker 的实际限制**：不能访问 DOM，通信要序列化（大对象有拷贝成本，用 `Transferable` 或 `SharedArrayBuffer` 避免）。适合纯计算：解析大 JSON、图像处理、加解密、大数组排序。
