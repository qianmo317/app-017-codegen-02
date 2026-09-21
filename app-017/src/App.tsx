import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AppSettings } from './types';
import { loadSettings, saveSettings } from './lib/settings';
import { usePath } from './router';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import PrintPage from './pages/PrintPage';
import LibraryPage from './pages/LibraryPage';
import SettingsPage from './pages/SettingsPage';
import ComparePage from './pages/ComparePage';

interface SettingsCtx {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}

export const SettingsContext = createContext<SettingsCtx>({
  settings: loadSettings(),
  update: () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const path = usePath();

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.classList.toggle('high-contrast', settings.highContrast);
    document.documentElement.style.fontSize = `${settings.fontScale}%`;
  }, [settings]);

  const ctx = useMemo<SettingsCtx>(
    () => ({
      settings,
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
    }),
    [settings],
  );

  let page: JSX.Element;
  if (path === '/' || path === '') page = <HomePage />;
  else if (path === '/library') page = <LibraryPage />;
  else if (path === '/settings') page = <SettingsPage />;
  else if (path === '/compare') {
    const q = new URLSearchParams(window.location.search);
    page = <ComparePage oldId={q.get('old') ?? undefined} newId={q.get('new') ?? undefined} />;
  }
  else if (/^\/editor\/[^/]+\/print$/.test(path)) page = <PrintPage id={path.split('/')[2]} />;
  else if (/^\/editor\/[^/]+$/.test(path)) page = <EditorPage id={path.split('/')[2]} />;
  else page = <HomePage />;

  return (
    <SettingsContext.Provider value={ctx}>
      <a href="#main" className="skip-link">
        跳到主要内容
      </a>
      <nav className="topnav" aria-label="主导航">
        <span className="brand">盲文点字排版与打印工作室</span>
        <a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
          首页
        </a>
        <a href="/compare" onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', '/compare'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
          版本对比
        </a>
        <a href="/library" onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', '/library'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
          模板与词语表
        </a>
        <a href="/settings" onClick={(e) => { e.preventDefault(); window.history.pushState(null, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
          设置
        </a>
      </nav>
      <main id="main">{page}</main>
      <footer className="footer">纯前端离线应用 · 规则依据 GB/T 15720-1995 与 GF 0019-2018</footer>
    </SettingsContext.Provider>
  );
}
