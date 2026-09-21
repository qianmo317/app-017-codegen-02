import { defineConfig } from 'vitest/config';
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
    // e2e/ 是 Playwright 用例（npm run e2e），不进入 vitest
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
