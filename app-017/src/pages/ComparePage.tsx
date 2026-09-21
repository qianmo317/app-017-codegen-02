import { useEffect, useMemo, useState } from 'react';
import type { BrailleCell, Doc } from '../types';
import { useSettings } from '../App';
import { navigate } from '../router';
import { getDoc, listDocs, saveDoc } from '../lib/storage';
import {
  extractModel,
  compareDocs,
  changeText,
  changeLocation,
  formatPos,
  type CellPos,
  type DiffChange,
  type DiffResult,
  type DocModel,
  type ChangeKind,
} from '../lib/diff';
import { applySelectedChanges } from '../lib/patch';
import PageView, { type DiffHighlight } from '../components/PageView';

type Side = 'old' | 'new';
type FilterKind = 'all' | ChangeKind | 'suspicious' | 'moved';

export default function ComparePage({ oldId: initialOld, newId: initialNew }: { oldId?: string; newId?: string }) {
  const { settings } = useSettings();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [oldId, setOldId] = useState(initialOld ?? '');
  const [newId, setNewId] = useState(initialNew ?? '');
  const [oldDoc, setOldDoc] = useState<Doc | null>(null);
  const [newDoc, setNewDoc] = useState<Doc | null>(null);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ side: Side; pos: CellPos } | null>(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    listDocs().then(setDocs);
  }, []);

  const loadSide = (id: string, who: Side) => {
    if (!id) {
      if (who === 'old') setOldDoc(null);
      else setNewDoc(null);
      return;
    }
    getDoc(id).then((d) => {
      if (who === 'old') setOldDoc(d ?? null);
      else setNewDoc(d ?? null);
    });
  };
  useEffect(() => loadSide(oldId, 'old'), [oldId]);
  useEffect(() => loadSide(newId, 'new'), [newId]);

  const diffOpts = useMemo(
    () => ({
      toneMode: settings.toneMode,
      autoDetectPinyin: settings.autoDetectPinyin,
      dictEntries: settings.dictEntries,
      showPageNumbers: settings.showPageNumbers,
    }),
    [settings.toneMode, settings.autoDetectPinyin, settings.dictEntries, settings.showPageNumbers],
  );

  const oldModel: DocModel | null = useMemo(
    () => (oldDoc ? extractModel(oldDoc, diffOpts) : null),
    [oldDoc, diffOpts],
  );
  const newModel: DocModel | null = useMemo(
    () => (newDoc ? extractModel(newDoc, diffOpts) : null),
    [newDoc, diffOpts],
  );
  const result: DiffResult | null = useMemo(
    () => (oldModel && newModel ? compareDocs(oldModel, newModel) : null),
    [oldModel, newModel],
  );

  // 切换对比对象后清空选择与跳转
  useEffect(() => {
    setChecked(new Set());
    setFocus(null);
  }, [oldId, newId]);

  const visibleChanges = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.changes;
    if (filter === 'suspicious') return result.changes.filter((c) => c.suspicious);
    if (filter === 'moved') return result.changes.filter((c) => c.structural !== 'edit');
    return result.changes.filter((c) => c.kind === filter);
  }, [result, filter]);

  /** 高亮光：把当前筛选范围内每条改动涉及的方对象映射到类别（未勾选不变暗） */
  const buildHighlights = (side: Side): Map<BrailleCell, DiffHighlight> => {
    const map = new Map<BrailleCell, DiffHighlight>();
    if (!result) return map;
    const model = side === 'old' ? oldModel : newModel;
    if (!model) return map;
    for (const c of result.changes) {
      if (filter !== 'all' && !matchesFilter(c, filter)) continue;
      const refs = side === 'old' ? c.oldCells : c.newCells;
      if (refs.length === 0) continue;
      const hl: DiffHighlight = c.suspicious
        ? 'suspicious'
        : c.kind === 'added'
          ? 'added'
          : c.kind === 'removed'
            ? 'removed'
            : 'reading';
      for (const ref of refs) {
        const cellObj = model.cellObjectById.get(ref.cellId);
        if (cellObj) map.set(cellObj, hl);
      }
    }
    return map;
  };

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setChecked((prev) => {
      const next = new Set(prev);
      const allSelected = visibleChanges.every((c) => next.has(c.id));
      if (allSelected) visibleChanges.forEach((c) => next.delete(c.id));
      else visibleChanges.forEach((c) => next.add(c.id));
      return next;
    });
  };

  const selectedChanges = useMemo(
    () => (result ? result.changes.filter((c) => checked.has(c.id)) : []),
    [result, checked],
  );

  /** 搬移并在完成后重比（model 由 doc 更新自动重建） */
  const patch = async (direction: 'new-to-old' | 'old-to-new') => {
    if (!result || !oldDoc || !newDoc || !oldModel || !newModel || selectedChanges.length === 0) return;
    const report = applySelectedChanges(direction, selectedChanges, oldDoc, oldModel, newDoc, newModel);
    const targetId = direction === 'new-to-old' ? oldId : newId;
    await saveDoc(report.doc);
    // 刷新对应一侧
    const fresh = await getDoc(targetId);
    if (direction === 'new-to-old') setOldDoc(fresh ?? report.doc);
    else setNewDoc(fresh ?? report.doc);
    setChecked(new Set());
    const skipMsg = report.skipped.length
      ? `；${report.skipped.length} 条未应用（${report.skipped.map((s) => s.reason).join('；')}）`
      : '';
    setFlash(`已搬移 ${report.applied} 处改动${skipMsg}，已重新对比，请查看剩余差异。`);
  };

  const jump = (c: DiffChange, side: Side) => {
    const pos = changeLocation(c, side);
    if (pos) setFocus({ side, pos });
  };

  return (
    <div>
      <div className="editor-header">
        <button type="button" onClick={() => navigate('/')}>
          ← 首页
        </button>
        <h1 style={{ margin: 0, fontSize: '1.15rem' }}>版本对比</h1>
        <span className="stats">按方比对新增 / 删除 / 换读音；整段移动与拆段不算改动</span>
      </div>

      {/* 选择两版 */}
      <div className="compare-pickers">
        <label>
          旧版（A）
          <select value={oldId} onChange={(e) => setOldId(e.target.value)} aria-label="选择旧版文档">
            <option value="">— 选择旧版 —</option>
            {docs?.map((d) => (
              <option key={d.id} value={d.id} disabled={d.id === newId}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
        <span className="compare-arrow" aria-hidden="true">⇄</span>
        <label>
          新版（B）
          <select value={newId} onChange={(e) => setNewId(e.target.value)} aria-label="选择新版文档">
            <option value="">— 选择新版 —</option>
            {docs?.map((d) => (
              <option key={d.id} value={d.id} disabled={d.id === oldId}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(!oldModel || !newModel) && (
        <p className="stats">请各选一份要对比的稿子。两版会在浏览器本地比对，不上传任何内容。</p>
      )}

      {result && oldModel && newModel && oldDoc && newDoc && (
        <>
          {/* 总览 */}
          <div className="compare-summary" role="status" aria-live="polite">
            <span className="chip chip-added">新加 {result.summary.added}</span>
            <span className="chip chip-removed">删除 {result.summary.removed}</span>
            <span className="chip chip-reading">换读音 {result.summary.reading}</span>
            <span className="chip">整段位移 {result.summary.moved}</span>
            <span className="chip">拆段 {result.summary.split}</span>
            <span className="chip">合段 {result.summary.merge}</span>
            <span className="stats">
              内容相似度 {Math.round(result.summary.similarity * 100)}%
            </span>
          </div>

          {result.warnings.map((w, i) => (
            <p key={i} className={`compare-warning ${w.level}`} role={w.level === 'error' ? 'alert' : 'status'}>
              {w.level === 'error' ? '⛔ ' : '⚠ '}
              {w.message}
            </p>
          ))}

          {result.events.length > 0 && (
            <details className="compare-events">
              <summary>结构位移（不算改动）：{result.events.length} 处</summary>
              <ul>
                {result.events.map((e, i) => (
                  <li key={i}>
                    <span className={`chip chip-${e.type}`}>{e.type === 'moved' ? '整段移动' : e.type === 'split' ? '拆分' : '合并'}</span>{' '}
                    {e.detail}
                    {e.contentChanged && <span className="stats">（段内的真实改动见下方清单）</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* 筛选 + 批量操作 */}
          <div className="compare-toolbar">
            <div className="row" role="group" aria-label="筛选改动">
              {([
                ['all', '全部'],
                ['added', '只看新加'],
                ['removed', '只看删除'],
                ['reading', '只看换读音'],
                ['suspicious', '疑似错位'],
                ['moved', '位移段内改动'],
              ] as [FilterKind, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={filter === k ? 'primary' : ''}
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="row">
              <button type="button" onClick={toggleAllVisible} disabled={visibleChanges.length === 0}>
                {visibleChanges.every((c) => checked.has(c.id)) ? '取消全选' : '全选当前筛选'}
              </button>
              <button
                type="button"
                className="primary"
                disabled={selectedChanges.length === 0}
                onClick={() => patch('new-to-old')}
                title="把勾选的新版改动搬到旧版（新增/新读音写入旧版，删除同步到旧版）"
              >
                把所选搬到旧版 ←（{selectedChanges.length}）
              </button>
              <button
                type="button"
                disabled={selectedChanges.length === 0}
                onClick={() => patch('old-to-new')}
                title="把勾选的旧版内容恢复进新版（用于误删回退）"
              >
                从旧版恢复到新版 →（{selectedChanges.length}）
              </button>
            </div>
          </div>
          {flash && (
            <p className="compare-flash" role="status" aria-live="polite">
              {flash}
            </p>
          )}

          <div className="compare-grid">
            {/* 改动清单 */}
            <section className="compare-list" aria-label="改动清单">
              <h2>
                改动清单 <span className="stats">{visibleChanges.length} 条</span>
              </h2>
              {visibleChanges.length === 0 ? (
                <p className="stats">这一筛选下没有改动。</p>
              ) : (
                <ul>
                  {visibleChanges.map((c) => {
                    const oldLoc = changeLocation(c, 'old');
                    const newLoc = changeLocation(c, 'new');
                    return (
                      <li key={c.id} className={`change-item kind-${c.kind}${c.suspicious ? ' suspicious' : ''}`}>
                        <label className="change-check">
                          <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                          <span>
                            <span className={`chip chip-${c.kind}`}>{kindLabel(c.kind)}</span>{' '}
                            {c.structural !== 'edit' && (
                              <span className="stats">[{structuralLabel(c.structural)}]</span>
                            )}{' '}
                            {changeText(c)}
                            {c.suspicious && <strong className="suspicious-tag"> 疑似错位</strong>}
                          </span>
                        </label>
                        <div className="change-locs">
                          {oldLoc && (
                            <button type="button" className="link-btn" onClick={() => jump(c, 'old')}>
                              旧版 {formatPos(c.oldCells.find((r) => r.pos))}
                            </button>
                          )}
                          {newLoc && (
                            <button type="button" className="link-btn" onClick={() => jump(c, 'new')}>
                              新版 {formatPos(c.newCells.find((r) => r.pos))}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* 双版预览 */}
            <section className="compare-previews">
              <div className="compare-preview-col">
                <h2>旧版（A）· {oldDoc.title}</h2>
                <div className="pages compare-pages" tabIndex={0}>
                  {oldModel.layout.pages.map((p) => (
                    <PageView
                      key={p.number}
                      page={p}
                      setup={oldDoc.setup}
                      highlights={buildHighlights('old')}
                      focusPos={focus?.side === 'old' ? focus.pos : null}
                    />
                  ))}
                </div>
              </div>
              <div className="compare-preview-col">
                <h2>新版（B）· {newDoc.title}</h2>
                <div className="pages compare-pages" tabIndex={0}>
                  {newModel.layout.pages.map((p) => (
                    <PageView
                      key={p.number}
                      page={p}
                      setup={newDoc.setup}
                      highlights={buildHighlights('new')}
                      focusPos={focus?.side === 'new' ? focus.pos : null}
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function matchesFilter(c: DiffChange, f: FilterKind): boolean {
  if (f === 'suspicious') return !!c.suspicious;
  if (f === 'moved') return c.structural !== 'edit';
  return c.kind === f;
}

function kindLabel(k: ChangeKind): string {
  return k === 'added' ? '新加' : k === 'removed' ? '删除' : '换读音';
}
function structuralLabel(s: DiffChange['structural']): string {
  return s === 'moved' ? '整段移动' : s === 'split' ? '拆段' : s === 'merge' ? '合段' : '';
}
