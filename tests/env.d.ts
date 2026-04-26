import type { EnvBindings } from '../src/worker/types'

declare module 'cloudflare:workers' {
  interface ProvidedEnv extends EnvBindings {}
}
