import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the Vite server is also a gateway to the API, the real-time socket and the
// media storage. One address (localhost:5173, the PC's LAN IP, or one ngrok link) then gives
// access to everything:
//   /v1        -> API            (http://localhost:3100)
//   /socket.io -> real-time      (ws://localhost:3100)
//   /s3        -> media storage  (http://localhost:9000, signed drawing and GIF links)
const gateway = {
  '/v1': { target: 'http://localhost:3100', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:3100', changeOrigin: true, ws: true },
  '/s3': {
    target: 'http://localhost:9000',
    changeOrigin: true, // the storage checks signatures against host localhost:9000
    rewrite: (path: string) => path.replace(/^\/s3/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from the phone / tablet on the same Wi-Fi
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'],
    proxy: gateway,
  },
  preview: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app', '.ngrok.io'],
    proxy: gateway,
  },
})
