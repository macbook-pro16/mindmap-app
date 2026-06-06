import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ★1. PWAを登録するための機能を読み込む
import { registerSW } from 'virtual:pwa-register'

// ★2. 自動でService Workerを登録して有効化する
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
