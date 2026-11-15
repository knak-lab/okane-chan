import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ビルドごとの版番号。画面に埋め込み、同じ値を dist/version.json にも書く。
// 開いている画面は version.json を読んで、違えば「新しいバージョンがあります」を出す（UpdateBanner）
const BUILD_ID = new Date().toISOString()

const versionFile = () => ({
  name: 'okane-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
  },
})

export default defineConfig({
  plugins: [react(), versionFile()],
  base: '/okane-chan/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
