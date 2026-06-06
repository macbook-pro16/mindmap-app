import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 1. PWAプラグインを読み込む（インポートする）
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // 2. plugins の配列の中に「VitePWA(...)」を追加する
  plugins: [
    react(), 
    VitePWA({
      registerType: 'autoUpdate', // アプリの更新を自動で反映する設定
      manifest: {
        name: 'MindMap Pro',       // スマホ等にインストールした時の正式名称
        short_name: 'MindMap',     // ホーム画面のアイコンの下に表示される短い名前
        description: 'マインドマップ作成ツール', // アプリの説明文
        theme_color: '#e16b8c',    // アプリのテーマカラー（ブラウザのバーなどの色）
        background_color: '#f8fafc', // アプリ起動時の背景色
        display: 'standalone',     // 上部のURLバーを隠して、普通のアプリのように見せる設定
        
        // 3. 使用するアイコンのファイルをここに登録する
        icons: [
          {
            src: '/icon-192.png',  // public/icon-192.png を指す
            sizes: '192x192',      // 画像の縦横サイズ
            type: 'image/png'      // 画像の形式
          },
          {
            src: '/icon-512.png',  // public/icon-512.png を指す
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
