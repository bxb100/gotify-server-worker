import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/index.ts',
      additionalExports: {
        StreamHub: 'DurableObject'
      },
      miniflare: {
        compatibilityDate: '2025-11-25',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: {
          STREAM_HUB: 'StreamHub'
        }
      }
    })
  ],
  test: {
    include: ['tests/**/*.test.ts']
  }
})
