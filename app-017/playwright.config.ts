import { defineConfig } from '@playwright/test';

// E2E_BASE_URL 可指向容器（如 http://localhost:8097）验证生产镜像，此时不启动本地服务
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4317';
const containerMode = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    // 容器内以非特权用户运行时需要：沙箱需要命名空间/特权
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
  webServer: containerMode
    ? undefined
    : {
        // 4173 常被兄弟项目（app-021 等）的 preview 占用，本项目使用独占端口 4317
        command: 'npm run build && npm run preview -- --port 4317 --strictPort',
        url: 'http://localhost:4317',
        reuseExistingServer: true,
        timeout: 180_000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', channel: 'chromium' } }],
});
