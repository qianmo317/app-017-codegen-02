import { useEffect, useMemo, useRef, useState } from 'react';
import type { Doc } from '../types';
import { listDocs, saveDoc, newDoc } from '../lib/storage';
import { diffDocuments, applyChanges, type ChangeItem, type CellLoc } from '../lib/diff';
import { useSettings } from '../App';
import { navigate } from '../router';

const KIND_LABEL: Record<ChangeItem['kind'], string> = {
  added: '新增',
  deleted: '删除',
  modified: '换读音',
};
const KIND_BADGE: Record<ChangeItem['kind'], string> = {
  added: 'badge add',
  deleted: 'badge del',
  modified: 'badge mod',
};

function locText(loc: CellLoc | undefined): string {
  return loc ? `第${loc.page}页 第${loc.line}行 第${loc.cell}方` : '位置未知';
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 版本对比：选两份文档逐字比对，改动可逐条挑选并搬到另一版 */
export default function ComparePage() {
  const { settings } = useSettings();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [liveMsg, setLiveMsg] = useState('');
  const [applyNote, setApplyNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingReport = useRef(false);

  useEffect(() => {
    listDocs().then((ds) => {
      setDocs(ds);
      // 支持 /compare?a=..&b=.. 深链；否则默认选最近的两份（新的是 B）
      const q = new URLSearchParams(window.location.search);
      const qa = q.get('a');
      const qb = q.get('b');
      if (qa && ds.some((d) => d.id === qa)) setAId(qa);
      else if (ds.length >= 2) setAId(ds[1].id);
      if (qb && ds.some((d) => d.id === qb)) setBId(qb);
      else if (ds.length >= 1) setBId(ds[0].id);
    });
  }, []);

  const docA = docs?.find((d) => d.id === aId) ?? null;
  const docB = docs?.find((d) => d.id === bId) ?? null;

  const result = useMemo(() => {
    if (!docA || !docB || docA.id === docB.id) return null;
    const optsFor = (d: Doc) => ({
      toneMode: settings.toneMode,
      autoDetectPinyin: settings.autoDetectPinyin,
      profile: d.ruleProfile,
      overrides: d.overrides,
      confirmed: d.confirmed,
      dictEntries: settings.dictEntries,
    });
    return diffDocuments(docA, docB, optsFor(docA), optsFor(docB), settings.showPageNumbers);
  }, [docA, docB, settings.toneMode, settings.autoDetectPinyin, settings.dictEntries, settings.showPageNumbers]);

  // 换一对文档就清空已选；手动切换版本时同时清除上一次的合并备注
  useEffect(() => {
    setSelected(new Set());
    if (!pendingReport.current) setApplyNote('');
  }, [result]);

  // 应用改动后自动重比，播报剩余
  useEffect(() => {
    if (pendingReport.current && result) {
      pendingReport.current = false;
      setLiveMsg(
        result.changes.length === 0
          ? '已重新对比：两版内容一致，没有剩余改动。'
          : `已重新对比：剩余 ${result.stats.added} 处新增、${result.stats.deleted} 处删除、${result.stats.modified} 处读音变更。`,
      );
    }
  }, [result]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applySelected = async (direction: 'forward' | 'reverse') => {
    if (!result || !docA || !docB || selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const items = result.changes.filter((c) => selected.has(c.id));
      const target = direction === 'forward' ? docA : docB;
      const other = direction === 'forward' ? docB : docA;
      const { raw, overrides, confirmed, skipped } = applyChanges(target, items, direction);
      const merged = newDoc({
        title: `${target.title}·合并${items.length}处`,
        raw,
        overrides,
        confirmed,
        setup: target.setup,
        ruleProfile: target.ruleProfile,
      });
      await saveDoc(merged);
      const ds = await listDocs();
      setDocs(ds);
      pendingReport.current = true;
      if (direction === 'forward') setAId(merged.id);
      else setBId(merged.id);
      setApplyNote(
        `已生成新文档《${merged.title}》（基于版本${direction === 'forward' ? 'A' : 'B'}，并入 ${items.length} 处改动），已自动与《${other.title}》重新对比。` +
          (skipped.length ? `有 ${skipped.length} 条非汉字的点字变化无法自动应用：${skipped.join('、')}。` : ''),
      );
      setLiveMsg(`已生成新文档《${merged.title}》，正在重新对比。`);
    } finally {
      setBusy(false);
    }
  };

  const swap = () => {
    const t = aId;
    setAId(bId);
    setBId(t);
  };

  if (docs === null) return <p>加载中…</p>;

  const selectProps = (label: string, value: string, set: (v: string) => void) => (
    <label>
      {label}
      <select value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">（请选择）</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}（{new Date(d.updatedAt).toLocaleString('zh-CN')}）
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div className="editor-header">
        <button type="button" onClick={() => navigate('/')}>
          ← 首页
        </button>
        <h1 style={{ margin: 0, flex: 1 }}>版本对比</h1>
      </div>

      <p className="visually-hidden" aria-live="polite" role="status">
        {liveMsg}
      </p>

      {docs.length < 2 ? (
        <p>
          至少需要两份文档才能对比。请先在首页新建文档（同一稿子每改一版可另存一份：打开文档后修改内容会自动保存为新版本，或复制原文另建一份）。
        </p>
      ) : (
        <>
          <div className="compare-selects">
            {selectProps('版本 A（旧）', aId, setAId)}
            <button type="button" onClick={swap} aria-label="交换两个版本">
              ⇄ 交换
            </button>
            {selectProps('版本 B（新）', bId, setBId)}
          </div>

          {docA && docB && docA.id === docB.id && <p role="alert">请选择两份不同的文档。</p>}
          {docA && docB && docA.id !== docB.id && docA.updatedAt > docB.updatedAt && (
            <p className="stats">提示：版本 A 的保存时间比版本 B 更新，新旧可能选反了（可点「⇄ 交换」）。</p>
          )}

          {result && (
            <>
              {applyNote && (
                <p className="apply-note" role="status">
                  {applyNote}
                </p>
              )}
              {result.warnings.length > 0 && (
                <div role="alert">
                  {result.warnings.map((w, i) => (
                    <p className="violation-item" key={i}>
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              )}

              <h2>
                改动清单{' '}
                <span className="stats" role="status">
                  {result.changes.length === 0
                    ? '两版内容一致，没有改动'
                    : `共 ${result.changes.length} 处：新增 ${result.stats.added} · 删除 ${result.stats.deleted} · 换读音 ${result.stats.modified}`}
                  {result.infos.length > 0 && `（另有 ${result.infos.length} 处移动/段落调整，不计改动）`}
                </span>
              </h2>

              {result.changes.length > 0 && (
                <>
                  <div className="diff-toolbar">
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(result.changes.map((c) => c.id)))}
                    >
                      全选
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())}>
                      全不选
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={selected.size === 0 || busy}
                      title="把选中的改动应用到版本 A，生成一份新文档，并自动与版本 B 重新对比"
                      onClick={() => applySelected('forward')}
                    >
                      把选中改动搬到版本 A（生成新文档）
                    </button>
                    <button
                      type="button"
                      disabled={selected.size === 0 || busy}
                      title="在版本 B 上撤销选中的改动，生成一份新文档，并自动与版本 A 重新对比"
                      onClick={() => applySelected('reverse')}
                    >
                      从版本 B 撤掉这些改动（生成新文档）
                    </button>
                    <span className="stats">已选 {selected.size} 条</span>
                  </div>

                  <ul className="diff-list" aria-label="改动列表">
                    {result.changes.map((c, idx) => (
                      <li className="diff-item" key={c.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                            aria-label={`选择第 ${idx + 1} 处改动：${KIND_LABEL[c.kind]} ${truncate(c.text, 20)}`}
                          />
                          <span className={KIND_BADGE[c.kind]}>{KIND_LABEL[c.kind]}</span>
                          <span className="diff-loc">
                            {c.kind === 'added' && `版本B · ${locText(c.locB)}`}
                            {c.kind === 'deleted' && `版本A · ${locText(c.locA)}`}
                            {c.kind === 'modified' &&
                              `版本A ${locText(c.locA)} → 版本B ${locText(c.locB)}`}
                          </span>
                          <span className="diff-content">
                            {c.kind === 'added' && <ins>{truncate(c.text)}</ins>}
                            {c.kind === 'deleted' && <del>{truncate(c.text)}</del>}
                            {c.kind === 'modified' && (
                              <span>
                                「{c.text}」{c.readingA || '（无读音）'} → {c.readingB || '（无读音）'}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {result.infos.length > 0 && (
                <section aria-label="不计为改动的调整">
                  <h2>
                    不计为改动 <span className="stats">（整段移动与段落拆分/合并，{result.infos.length} 处）</span>
                  </h2>
                  <ul className="diff-list">
                    {result.infos.map((info, i) => (
                      <li className="diff-item info" key={i}>
                        <span className="badge">{info.kind === 'moved' ? '移动' : info.kind === 'split' ? '分段' : '并段'}</span>{' '}
                        {info.kind === 'moved' && (
                          <span>
                            「{truncate(info.text, 40)}」整段移动：版本A {locText(info.locA)} → 版本B {locText(info.locB)}
                          </span>
                        )}
                        {info.kind === 'split' && (
                          <span>
                            「{truncate(info.text, 30)}」在版本B 拆成了 {info.detail ?? 2} 段（版本B {locText(info.locB)}）
                          </span>
                        )}
                        {info.kind === 'merged' && (
                          <span>
                            版本A 的 {info.detail ?? 2} 段在版本B 并成了一段「{truncate(info.text, 30)}」（版本A {locText(info.locA)}）
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
