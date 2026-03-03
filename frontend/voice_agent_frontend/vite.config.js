import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',     // Required for Docker
    proxy: {
      '/livekit': {
        target: process.env.VITE_BACKEND_URL || 'https://ai-agent-itlm.onrender.com',
        changeOrigin: true,
      },
      '/appointments': {
        target: process.env.VITE_BACKEND_URL || 'https://ai-agent-itlm.onrender.com',
        changeOrigin: true,
      },
      '/slots': {
        target: process.env.VITE_BACKEND_URL || 'https://ai-agent-itlm.onrender.com',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',       // <- ensures build goes into /dist
    sourcemap: true,      // optional, helpful for debugging
    rollupOptions: {
      output: {
        // keep asset names consistent
        assetFileNames: 'assets/[name].[hash].[ext]',
        chunkFileNames: 'assets/[name].[hash].js',
        entryFileNames: 'assets/[name].[hash].js',
      },
    },
  },
})