import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    // e2e 由 Playwright 独立运行（npm run e2e），vitest 只收 tests/ 下的单测
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
