import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrailleCell, Doc } from '../types';
import { convertText } from '../lib/convert';
import { layoutDocument } from '../lib/layout';
import { getDoc, saveDoc } from '../lib/storage';
import { useSettings } from '../App';
import { navigate } from '../router';
import PageView from '../components/PageView';
import UncertainPanel from '../components/UncertainPanel';

const PROFILES: { value: Doc['ruleProfile']; label: string }[] = [
  { value: 'zh-current', label: '现行汉语盲文（GB/T 15720）' },
  { value: 'ueb', label: 'UEB 英文盲文' },
  { value: 'gb-english', label: 'GB 英语盲文' },
];

export default function EditorPage({ id }: { id: string }) {
  const { settings, update } = useSettings();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<{ line: number; cell: number } | null>(null);
  const [selectedCell, setSelectedCell] = useState<BrailleCell | null>(null);
  const [customReading, setCustomReading] = useState('');
  const [liveMsg, setLiveMsg] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getDoc(id).then((d) => {
      if (!alive) return;
      if (d) setDoc(d);
      else setNotFound(true);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const persist = useCallback(
    (next: Doc) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveDoc(next).then(() => setSavedAt(Date.now()));
      }, 400);
    },
    [],
  );

  const patchDoc = useCallback(
    (patch: Partial<Doc>) => {
      setDoc((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch, updatedAt: Date.now() };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const convertOptions = useMemo(
    () => ({
      toneMode: settings.toneMode,
      autoDetectPinyin: settings.autoDetectPinyin,
      profile: doc?.ruleProfile ?? 'zh-current',
      overrides: doc?.overrides,
      confirmed: doc?.confirmed,
      dictEntries: settings.dictEntries,
    }),
    [settings.toneMode, settings.autoDetectPinyin, settings.dictEntries, doc?.ruleProfile, doc?.overrides, doc?.confirmed],
  );

  const converted = useMemo(
    () => (doc ? convertText(doc.raw, convertOptions) : null),
    [doc?.raw, convertOptions],
  );
  const layout = useMemo(
    () => (converted && doc ? layoutDocument(converted.paragraphs, doc.setup, settings.showPageNumbers) : null),
    [converted, doc?.setup, settings.showPageNumbers],
  );

  // 预览行号反查：选中格 → 原字符
  const handleCellClick = (cell: BrailleCell | null, line: number, cellIdx: number) => {
    setSelected({ line, cell: cellIdx });
    setSelectedCell(cell);
    setCustomReading(cell?.reading ?? '');
  };

  const applyReading = (char: string, reading: string) => {
    if (!doc) return;
    const overrides = { ...(doc.overrides ?? {}) };
    if (reading.trim()) overrides[char] = reading.trim();
    else delete overrides[char];
    const confirmed = [...new Set([...(doc.confirmed ?? []), char])];
    patchDoc({ overrides, confirmed });
    setLiveMsg(`已确认 ${char} 读音为 ${reading}`);
  };

  const confirmAllDefault = () => {
    if (!doc || !converted) return;
    const confirmed = [...new Set([...(doc.confirmed ?? []), ...converted.uncertain.map((u) => u.char)])];
    patchDoc({ confirmed });
    setLiveMsg(`已按默认读音确认 ${confirmed.length} 个字`);
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      setLiveMsg(
        converted
          ? `转换完成：共 ${layout?.pages.length ?? 0} 页，${converted.stats.cellCount} 方，${converted.uncertain.length} 项待确认`
          : '没有可转换的内容',
      );
      document.querySelector<HTMLElement>('.pages')?.focus();
    }
  };

  if (notFound) {
    return (
      <div>
        <p>文档不存在或已删除。</p>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
          返回首页
        </a>
      </div>
    );
  }
  if (!doc || !converted || !layout) return <p>加载中…</p>;

  const uncertainCount = converted.uncertain.length;
  const hasViolations = layout.violations.length > 0;
  const exportBlocked = uncertainCount > 0;

  return (
    <div>
      <div className="editor-header">
        <button type="button" onClick={() => navigate('/')}>
          ← 首页
        </button>
        <label style={{ margin: 0, flex: 1 }}>
          <span className="visually-hidden">文档标题</span>
          <input
            type="text"
            value={doc.title}
            onChange={(e) => patchDoc({ title: e.target.value })}
            aria-label="文档标题"
          />
        </label>
        <span className="stats" role="status">
          {savedAt ? '已保存' : ''}
        </span>
        <button
          type="button"
          className="primary"
          disabled={exportBlocked}
          title={exportBlocked ? '存在未确认的读音，确认后才能导出' : '进入打印与导出'}
          onClick={() => navigate(`/editor/${doc.id}/print`)}
        >
          打印与导出 →
        </button>
      </div>

      <p className="visually-hidden" aria-live="polite" role="status">
        {liveMsg}
      </p>

      <div className="editor-grid">
        {/* 左：原文 */}
        <section className="editor-col" aria-label="原文输入">
          <h2>
            原文{' '}
            <span className="stats">
              （Ctrl+Enter 转换；支持汉字、拼音、数字、英文、标点）
            </span>
          </h2>
          <textarea
            value={doc.raw}
            onChange={(e) => patchDoc({ raw: e.target.value })}
            onKeyDown={onTextareaKeyDown}
            aria-label="原文输入区"
            placeholder={'在此输入要转换的文本…\n例如：特殊教育 12.5 AB\n\n空行分段。'}
          />
          {hasViolations && (
            <div role="alert">
              {layout.violations.map((v, i) => (
                <p className="violation-item" key={i}>
                  ⚠ 词「{v.word}」长 {v.cells} 方，超过行宽 {doc.setup.cellsPerLine}，已强制拆分——请修改或加宽行宽。
                </p>
              ))}
            </div>
          )}
        </section>

        {/* 中：分页预览 */}
        <section className="editor-col" aria-label="盲文分页预览">
          <h2 className="row" style={{ justifyContent: 'space-between' }}>
            <span>盲文预览</span>
            <span className="stats">
              {layout.pages.length} 页 · {converted.stats.cellCount} 方
            </span>
          </h2>
          <div className="pages" tabIndex={0} aria-label="分页预览，可滚动">
            {layout.pages.map((p) => (
              <PageView
                key={p.number}
                page={p}
                setup={doc.setup}
                selected={selected}
                onCellClick={handleCellClick}
              />
            ))}
          </div>
        </section>

        {/* 右：设置与确认 */}
        <section className="editor-col" aria-label="规则与确认">
          <div className="panel-section">
            <h2>
              待确认读音{' '}
              {exportBlocked && <span className="badge error">导出已锁定</span>}
            </h2>
            <UncertainPanel
              items={converted.uncertain}
              onConfirm={applyReading}
              onConfirmAllDefault={confirmAllDefault}
            />
          </div>

          <div className="panel-section">
            <h2>所选方</h2>
            {selectedCell && selectedCell.source ? (
              <div>
                <p>
                  字符「{selectedCell.source}」·{' '}
                  {selectedCell.reading ? `读音 ${selectedCell.reading}` : selectedCell.kind}
                  {selectedCell.uncertain ? ' · 未确认' : ''}
                </p>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (selectedCell.source) applyReading(selectedCell.source, customReading);
                  }}
                >
                  <label>
                    <span className="visually-hidden">为所选字符指定拼音</span>
                    <input
                      type="text"
                      value={customReading}
                      onChange={(e) => setCustomReading(e.target.value)}
                      placeholder="拼音（如 chang2），留空清除"
                    />
                  </label>
                  <button type="submit" className="primary">
                    应用
                  </button>
                </form>
              </div>
            ) : (
              <p className="stats">点击预览中的任意方进行编辑。</p>
            )}
          </div>

          <div className="panel-section">
            <h2>盲文规则</h2>
            <label>
              规则档位
              <select
                value={doc.ruleProfile}
                onChange={(e) => patchDoc({ ruleProfile: e.target.value as Doc['ruleProfile'] })}
              >
                {PROFILES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标调模式
              <select value={settings.toneMode} onChange={(e) => update({ toneMode: e.target.value as never })}>
                <option value="national">国家通用盲文（省写规则）</option>
                <option value="all">全部标调</option>
                <option value="none">不标调</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.autoDetectPinyin}
                onChange={(e) => update({ autoDetectPinyin: e.target.checked })}
              />{' '}
              字母串自动识别拼音
            </label>
          </div>

          <div className="panel-section">
            <h2>页面设置</h2>
            <label>
              每行方数
              <input
                type="number"
                min={10}
                max={60}
                value={doc.setup.cellsPerLine}
                onChange={(e) =>
                  patchDoc({ setup: { ...doc.setup, cellsPerLine: Math.max(10, Number(e.target.value) || 32) } })
                }
              />
            </label>
            <label>
              每页行数
              <input
                type="number"
                min={10}
                max={50}
                value={doc.setup.linesPerPage}
                onChange={(e) =>
                  patchDoc({ setup: { ...doc.setup, linesPerPage: Math.max(10, Number(e.target.value) || 25) } })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={doc.setup.doubleSided}
                onChange={(e) => patchDoc({ setup: { ...doc.setup, doubleSided: e.target.checked } })}
              />{' '}
              双面打印
            </label>
            <div className="row">
              <label>
                上边距 mm
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={doc.setup.marginMm.top}
                  onChange={(e) =>
                    patchDoc({ setup: { ...doc.setup, marginMm: { ...doc.setup.marginMm, top: Number(e.target.value) || 20 } } })
                  }
                />
              </label>
              <label>
                左边距 mm
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={doc.setup.marginMm.left}
                  onChange={(e) =>
                    patchDoc({ setup: { ...doc.setup, marginMm: { ...doc.setup.marginMm, left: Number(e.target.value) || 15 } } })
                  }
                />
              </label>
            </div>
            <label>
              <input
                type="checkbox"
                checked={settings.showPageNumbers}
                onChange={(e) => update({ showPageNumbers: e.target.checked })}
              />{' '}
              显示盲文页码
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
