import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const require = createRequire(import.meta.url)
const polyfillRequire = createRequire(require.resolve('vite-plugin-node-polyfills'))

export default defineConfig({
    plugins: [vue(), nodePolyfills({
        overrides: {
            // readable-stream imports process/; resolve it to a file for Vite's dependency optimizer.
            process: polyfillRequire.resolve('process/browser.js')
        }
    })],
    server: {
        port: 5175,
        strictPort: true,
        watch: {
            usePolling: true
        }
    }
})
