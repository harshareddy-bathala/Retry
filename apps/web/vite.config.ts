import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev so the SameSite=Strict refresh cookie works unchanged.
      // Overridable so a second stack (a worktree drive) can run beside dev.
      '/api': process.env['API_PROXY_TARGET'] ?? 'http://localhost:3000',
    },
  },
});
