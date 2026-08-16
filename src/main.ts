import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// highlight.js 的配色主题。github-dark 和 global.css 里 pre 的深色背景搭配
import 'highlight.js/styles/github-dark.css'
import './styles/global.css'

createApp(App).use(createPinia()).mount('#app')
