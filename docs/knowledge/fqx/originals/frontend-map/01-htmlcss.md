# 前端 > HTML / CSS 与渲染管线 > 资料说明

来源：https://fqx.lx.ci/frontend-map/

来源：https://fqx.lx.ci/frontend-map/

主线对齐 2026 年的实际工程状况：Vite 6+ / Vue 3.5+ / React 19 / TypeScript 5.7+。INP 已取代 FID，X-XSS-Protection 已废弃，涉及版本差异处单独标注。

这份导图不按「HTML / CSS / JS 三件套」平铺，按**问题的深度**排：**渲染管线**解释为什么某些 CSS 改动便宜、某些昂贵；**JavaScript 核心**是闭包、原型、this、事件循环这四个绕不开的机制；**模块化与构建**讲 ESM 的静态结构如何决定了 tree-shaking 和 Vite 的架构；**框架原理**把 Vue 和 React 的差异归到一个根本分歧上；**网络与性能**从指标出发而不是从优化清单出发；**安全与部署**最后一节专讲 AI 应用带来的新攻击面。

每个节点讲三件事：是什么、为什么这么设计、你会踩的坑。坑那部分是重点 —— 面试区分度不在你知不知道 Flex 有哪些属性，在你是否遇过 `min-width: 0` 那种问题。

# 前端 > HTML / CSS 与渲染管线

来源：https://fqx.lx.ci/frontend-map/

这块的核心不是标签和属性表，是**浏览器怎么把字符串变成屏幕上的像素**。搞清 DOM → CSSOM → Layout → Paint → Composite 这条链，你就知道为什么某些 CSS 属性改了很便宜、某些一改就整页重排。

# 前端 > HTML / CSS 与渲染管线 > 渲染管线：五步，代价递减

来源：https://fqx.lx.ci/frontend-map/

浏览器拿到 HTML 后走这五步：

```
HTML  → DOM 树
CSS   → CSSOM 树
        ↓ 合并
      Render Tree（只含可见节点）
        ↓
      Layout（回流 / reflow）—— 算每个盒子的位置和尺寸
        ↓
      Paint（重绘 / repaint）—— 填颜色、画边框、画文字
        ↓
      Composite（合成）—— 把图层拼起来交给 GPU
```

**关键是「从哪一步开始重做」决定代价**：

| 你改了什么 | 从哪步重做 | 代价 |
|---|---|---|
| `width` / `height` / `top` / `margin` / 增删节点 | Layout | 最贵，可能整页 |
| `color` / `background` / `box-shadow` / `visibility` | Paint | 中等 |
| `transform` / `opacity` | 只 Composite | 最便宜，GPU 直接干 |

**所以做动画只用 `transform` 和 `opacity`**。用 `left`/`top` 做位移动画，每一帧都触发 Layout，60fps 下就是每 16.6ms 重排一次，中低端机直接掉帧。

**`display: none` 和 `visibility: hidden` 的区别不只是「占不占位」**：
- `display: none` —— 节点不进 Render Tree，改它触发 Layout
- `visibility: hidden` —— 在 Render Tree 里，占位，改它只触发 Paint

**布局抖动（layout thrashing）是这块最实际的坑**：

```js
// ✗ 强制同步布局，循环里读写交替 → 每次都要重算
for (const el of items) {
  el.style.height = el.offsetHeight + 10 + 'px';  // 读 offsetHeight 强制刷新布局
}

// ✓ 先批量读，再批量写
const heights = items.map(el => el.offsetHeight);
items.forEach((el, i) => el.style.height = heights[i] + 10 + 'px');
```

**触发强制同步布局的属性**：`offsetTop/Left/Width/Height`、`scrollTop`、`clientWidth`、`getComputedStyle()`、`getBoundingClientRect()`。读这些时浏览器必须把待处理的样式改动全部算完才能给你准确值。

# 前端 > HTML / CSS 与渲染管线 > 渲染管线：五步，代价递减 > 关键渲染路径与阻塞

来源：https://fqx.lx.ci/frontend-map/

**CSS 阻塞渲染，JS 阻塞解析**——这两句要分清：

```html
<link rel="stylesheet" href="a.css">   <!-- 阻塞渲染：CSSOM 没建好不敢画 -->
<script src="b.js"></script>            <!-- 阻塞解析：DOM 构建暂停，等下载+执行完 -->
<script src="b.js" defer></script>      <!-- 不阻塞解析，DOMContentLoaded 前按序执行 -->
<script src="b.js" async></script>      <!-- 不阻塞解析，下载完立刻执行，顺序不保证 -->
```

**为什么 JS 要阻塞解析**：脚本可能 `document.write()` 或改 DOM，浏览器不敢边解析边执行。

**`defer` vs `async` 的选择**：
- 有依赖关系、要操作 DOM → `defer`（按顺序、DOM 就绪后执行）
- 独立第三方脚本（统计、埋点）→ `async`

**JS 还会被 CSS 间接阻塞**：脚本里可能读 `getComputedStyle`，所以浏览器要等前面的 CSS 下载完才执行 JS。于是「一个慢 CSS」能连带卡住后面的 JS。

**优化手段的优先级**（按收益排）：
1. **内联首屏关键 CSS**，其余 CSS 用 `media` 或 JS 异步加载
2. **`<script defer>`** 放 `<head>`，比放 `</body>` 前更好——能提前开始下载
3. **`<link rel="preload">`** 提前拉字体和首屏图片
4. **字体用 `font-display: swap`**，否则字体没到之前文字不显示（FOIT）

**FOUC / FOIT 这两个词面试会问**：FOUC 是样式没到先显示裸 HTML；FOIT 是字体没到文字先隐形。前者靠 CSS 放 `<head>` 避免，后者靠 `font-display` 控制。

# 前端 > HTML / CSS 与渲染管线 > 渲染管线：五步，代价递减 > 盒模型与 BFC

来源：https://fqx.lx.ci/frontend-map/

**盒模型**：`content-box`（默认）算宽度不含 padding/border，`border-box` 含。现代项目基本都全局设：

```css
*, *::before, *::after { box-sizing: border-box; }
```

**margin 塌陷（collapse）是两种不同现象**，容易混：

```
1. 相邻兄弟：上下 margin 取较大值，不相加
   div{margin-bottom:20px} + div{margin-top:30px} → 间距 30px 不是 50px

2. 父子：子元素的 margin-top 会「穿透」到父元素外面
   父元素没有 border / padding / overflow 时发生
```

**BFC（块级格式化上下文）就是解决这类问题的隔离容器**。触发方式：
- `overflow: hidden / auto`（最常用，但会裁剪内容）
- `display: flow-root`（**专门为此设计的，没有副作用，优先用这个**）
- `display: flex / grid / inline-block`
- `position: absolute / fixed`
- `float: left / right`

**BFC 能解决三件事**：
1. 阻止 margin 穿透
2. 让父元素包住浮动子元素（清除浮动的原理）
3. 让元素不被浮动元素覆盖（两栏自适应布局的老做法）

**`display: flow-root` 是这里最值得记的**——它就是「创建 BFC」这一件事，没有 `overflow: hidden` 的裁剪副作用。很多人还在用 `overflow: hidden` 清浮动，然后发现子元素的 `box-shadow` 被切掉了。

# 前端 > HTML / CSS 与渲染管线 > Flex 与 Grid：什么时候用哪个

来源：https://fqx.lx.ci/frontend-map/

**一句话判断：Flex 管一个方向，Grid 管两个方向。**

Flex 是**内容驱动**的——先看内容多大，再分配剩余空间。Grid 是**容器驱动**的——先画好格子，内容往里放。

**Flex 最常被误解的三个属性**：

```css
flex: 1;              /* = flex: 1 1 0%   基准 0，完全按比例分 */
flex: auto;           /* = flex: 1 1 auto 基准是内容宽度，内容多的分得多 */
flex: none;           /* = flex: 0 0 auto 不伸不缩 */
```

**`flex: 1` 和 `flex: auto` 的差别就在 `flex-basis`**：想让几个子项等宽，用 `flex: 1`；想让它们按内容比例分，用 `flex: auto`。这是「为什么我写了 flex:1 还是不等宽」的答案——你写的可能是 `flex-grow: 1` 而 `flex-basis` 还是 `auto`。

**flex 子项溢出问题**：`min-width` 默认是 `auto`，所以 flex 子项**不会缩小到内容最小宽度以下**。文字长的时候会撑破容器：

```css
.flex-child {
  min-width: 0;        /* ✓ 允许缩到比内容更小 */
  overflow: hidden;
  text-overflow: ellipsis;
}
```

这个坑非常常见——「为什么我的 flex 布局被一段长文本撑出横向滚动条」，答案就是 `min-width: 0` 没写。

**Grid 的核心是命名和自适应**：

```css
.grid {
  display: grid;
  /* 自适应列数：能放几列放几列，最小 200px */
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}
```

**`auto-fill` vs `auto-fit`**：内容不够填满一行时，`auto-fill` 保留空轨道（元素不拉伸），`auto-fit` 折叠空轨道（元素拉满）。做卡片墙一般要 `auto-fill`，否则只有一个卡片时它会拉成全屏宽。

**`1fr` 不等于 `33.33%`**：`fr` 分配的是**剩余空间**，会扣掉 `gap`；百分比是整体宽度的比例，加上 gap 就溢出了。这是 Grid 比 Flex+百分比好用的直接原因。

# 前端 > HTML / CSS 与渲染管线 > 定位、层叠与 z-index 失效

来源：https://fqx.lx.ci/frontend-map/

**`z-index` 不起作用的三大原因**，按出现频率排：

**1. 没有定位上下文**。`z-index` 只对 `position` 不是 `static` 的元素生效（以及 flex/grid 子项）。

**2. 被父元素的层叠上下文困住**。这是最难查的一种：

```
父A (z-index: 1)          父B (z-index: 2)
  └ 子a (z-index: 9999)     └ 子b (z-index: 1)
```

子 a 的 9999 再大也压不过子 b——因为比较先在父 A 和父 B 之间进行，A 输了，它的所有后代都输。**z-index 只在同一个层叠上下文内可比。**

**3. 意外创建了层叠上下文**。这些属性会创建新的层叠上下文，很多人不知道：
- `transform` 任何非 none 值
- `opacity` 小于 1
- `filter`、`backdrop-filter`
- `will-change`
- `position: fixed / sticky`
- `contain: paint`
- `isolation: isolate`

**实际场景**：给卡片加了 `transform: translateY(-2px)` 的 hover 效果，结果里面的下拉菜单再也弹不出卡片外面了。原因就是 `transform` 创建了层叠上下文，也创建了新的包含块。

**`position: fixed` 相对谁定位**：正常相对视口，但**祖先有 `transform`/`filter`/`will-change` 时相对那个祖先**。这是「fixed 的弹窗跟着页面滚动了」的原因。

**`position: sticky` 失效的原因**：
- 父元素有 `overflow: hidden/auto/scroll`（sticky 会相对那个滚动容器，通常不是你想要的）
- 没设 `top`/`bottom` 中的任何一个（必须给阈值）
- 父元素高度不够，没有滚动空间

**层叠顺序（同一上下文内，从下到上）**：
```
背景和边框 → 负 z-index → block 盒 → float → inline → z-index:0/auto → 正 z-index
```

# 前端 > HTML / CSS 与渲染管线 > 语义化与可访问性：不是「加个 aria 就行」

来源：https://fqx.lx.ci/frontend-map/

**语义化的实际价值有三个，不是「对 SEO 好」这么笼统**：

1. **屏幕阅读器能导航**——用户可以按标题跳转、按 landmark 跳区域
2. **键盘可操作**——`<button>` 天然可聚焦、能按空格/回车触发，`<div onclick>` 什么都没有
3. **浏览器默认行为**——`<form>` 里的回车提交、`<label for>` 点文字聚焦输入框

**`<div onclick>` 要补齐的东西**（这就是为什么该用 `<button>`）：

```html
<!-- ✗ 看着能用，键盘用户和读屏用户都用不了 -->
<div onclick="submit()">提交</div>

<!-- 要变成等价的，得补这么多 -->
<div onclick="submit()"
     role="button"
     tabindex="0"
     onkeydown="if(e.key==='Enter'||e.key===' ')submit()">提交</div>

<!-- ✓ 直接用原生 -->
<button onclick="submit()">提交</button>
```

**面试常问「怎么做无障碍」，答这几条具体的**：
- **图片**：装饰性图片用 `alt=""`（不是省略 alt），内容性图片写有信息的 alt
- **表单**：每个 input 都要有关联的 `<label>`，`placeholder` 不能当标签用（聚焦后就消失了）
- **焦点可见**：不要 `outline: none` 而不给替代样式，用 `:focus-visible`
- **对比度**：正文至少 4.5:1（WCAG AA）
- **动态内容**：用 `aria-live="polite"` 播报异步更新的区域

**一个诚实的说法**：完整的无障碍验证需要真机配读屏软件测试和专家评审，光看代码和自动化工具（axe、Lighthouse）只能覆盖一部分。面试里这么说比吹「我们完全符合 WCAG」更可信。
