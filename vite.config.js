import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'child_process'

// Get Git SHA
let gitSha = ''
try {
    gitSha = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
    console.warn('Could not get git sha', e)
    gitSha = 'unknown'
}

export default defineConfig({
    plugins: [
        basicSsl()
    ],
    define: {
        __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0alpha'),
        __GIT_SHA__: JSON.stringify(gitSha),
        __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }))
    },
    server: {
        https: true,
        host: true, // Exposes the server to your local network
        proxy: {
            '/api': {
                target: 'https://localhost',
                secure: false, // Accept self-signed certs
                changeOrigin: true
            },
            '/peerjs': {
                target: 'https://localhost',
                secure: false,
                changeOrigin: true,
                ws: true // Important for PeerJS websockets
            },
            '/relay': {
                target: 'https://localhost',
                secure: false,
                changeOrigin: true,
                ws: true // Important for Relay websockets
            }
        }
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    three: ['three'],
                    peerjs: ['peerjs'],
                    rapier: ['@dimforge/rapier3d-compat']
                }
            }
        }
    }
})
