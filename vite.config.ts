import { cloudflare } from '@cloudflare/vite-plugin'
import clientTokenCleanupPlugin from '@gotify/client-token-cleanup'
import messageAutoDeletePlugin from '@gotify/message-auto-delete'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import generateLoadPlugin from './scripts/generate-load-plugin'

export default defineConfig({
  plugins: [
    generateLoadPlugin([clientTokenCleanupPlugin, messageAutoDeletePlugin]),
    react({
      babel: {
        plugins: [
          // I don't know why gotify ui don't need this
          ['@babel/plugin-proposal-decorators', { version: '2023-11' }]
        ]
      }
    }),
    cloudflare()
  ],
  build: {
    chunkSizeWarningLimit: 1000
  }
})
