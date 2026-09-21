/**
 * 选择性搬移：把对比结果里勾选的改动搬到另一版上。
 *
 * - 「新加 / 删除」是原文改动 → 修改目标文档的 raw。连续新加的一串字共用同一个
 *   「对侧插入锚点」（diff 引擎在对齐时算好），因此会作为一整块插入，不会错位乱序；
 * - 「换读音」是盲文读法改动 → 写入目标文档的 overrides（与编辑器逐方指定读音同一机制），
 *   并把该字加入 confirmed，避免搬过去后又被多音字面板拦住导出。
 *
 * 一批勾选改动原子应用：原文区间先按锚点/范围合并，再从后往前编辑，偏移互不干扰。
 * 应用完返回新 Doc（由调用方保存并重新 extractModel + compareDocs 复核剩余改动）。
 */
import type { Doc } from '../types';
import type { DocModel, DiffChange, DiffUnit } from './diff';

export interface PatchReport {
  /** 应用后的目标文档（未保存） */
  doc: Doc;
  applied: number;
  skipped: { change: DiffChange; reason: string }[];
}

export type PatchDirection =
  | /** 新版 → 旧版：把新版新增/新读音搬进旧版，或把旧版删除同步掉 */ 'new-to-old'
  | /** 旧版 → 新版 */ 'old-to-new';

interface RawEdit {
  start: number;
  end: number;
  replacement: string;
  change: DiffChange;
}

/** 方序号 → 所属单元 */
function unitOfCell(model: DocModel, cellId: number): DiffUnit | undefined {
  return model.units.find((u) => u.cellIds.includes(cellId));
}

/** 取来源模型中一组连续方所属单元覆盖的真实原文片段 */
function sourceSlice(model: DocModel, refs: { cellId: number }[]): string {
  const units = refs.map((r) => unitOfCell(model, r.cellId)).filter((u): u is DiffUnit => !!u);
  if (units.length === 0) return '';
  const first = units[0];
  const last = units[units.length - 1];
  return model.raw.slice(first.start, last.end);
}

/**
 * 把一组改动搬进目标文档。
 * @param direction 搬移方向，决定每类改动如何映射成目标文档上的编辑
 * @param changes   勾选的改动
 */
export function applySelectedChanges(
  direction: PatchDirection,
  changes: DiffChange[],
  oldDoc: Doc,
  oldModel: DocModel,
  newDoc: Doc,
  newModel: DocModel,
): PatchReport {
  const skipped: PatchReport['skipped'] = [];
  const edits: RawEdit[] = [];
  const readingByChar = new Map<string, string>();
  const clearCharReadings = new Set<string>();

  // 归一化成「目标文档上的编辑」
  for (const change of changes) {
    if (change.kind === 'reading') {
      // 读音随方向：新版→旧版 写入新读音；旧版→新版 恢复旧读音。
      const model = direction === 'new-to-old' ? newModel : oldModel;
      const refs = direction === 'new-to-old' ? change.newCells : change.oldCells;
      const unit = refs[0] ? unitOfCell(model, refs[0].cellId) : undefined;
      const ch = unit?.source ?? change.source;
      const targetReading = direction === 'new-to-old' ? change.newReading : change.oldReading;
      if (!ch || ch.length !== 1) {
        skipped.push({ change, reason: '读音改动找不到对应的单个汉字' });
        continue;
      }
      if (targetReading) readingByChar.set(ch, targetReading);
      else clearCharReadings.add(ch);
      continue;
    }

    if (direction === 'new-to-old') {
      // 目标 = 旧版：新版新加 → 插入旧版；旧版被删（change.removed）→ 从旧版删除
      if (change.kind === 'added') {
        if (change.insertAt === undefined) {
          skipped.push({ change, reason: '缺少插入位置（可能是整段新增，请手工处理）' });
          continue;
        }
        edits.push({
          start: change.insertAt,
          end: change.insertAt,
          replacement: sourceSlice(newModel, change.newCells),
          change,
        });
      } else {
        const first = change.oldCells[0] ? unitOfCell(oldModel, change.oldCells[0].cellId) : undefined;
        const last = change.oldCells.length
          ? unitOfCell(oldModel, change.oldCells[change.oldCells.length - 1].cellId)
          : undefined;
        if (!first || !last) {
          skipped.push({ change, reason: '改动单元已不存在（可能已经搬过）' });
          continue;
        }
        edits.push({ start: first.start, end: last.end, replacement: '', change });
      }
    } else {
      // 目标 = 新版：旧版被删 → 从新版也删（新版本来就没有，跳过）；
      // 新版新加不该撤销。因此 old-to-new 只处理「恢复旧版内容」：把 removed 单元插回新版。
      if (change.kind === 'removed') {
        if (change.insertAt === undefined) {
          skipped.push({ change, reason: '缺少恢复位置（可能是整段删除，请手工处理）' });
          continue;
        }
        edits.push({
          start: change.insertAt,
          end: change.insertAt,
          replacement: sourceSlice(oldModel, change.oldCells),
          change,
        });
      } else {
        // added 在新版已存在，无需操作
        skipped.push({ change, reason: '该改动在新版已经存在' });
      }
    }
  }

  const targetDoc = direction === 'new-to-old' ? oldDoc : newDoc;

  // 合并同一锚点的连续插入 / 重叠删除
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RawEdit[] = [];
  for (const edit of edits) {
    const last = merged[merged.length - 1];
    if (last && edit.start < last.end) {
      if (edit.start < last.end) {
        skipped.push({ change: edit.change, reason: '与另一条已选改动落在同一原文区域，已合并' });
      }
      if (edit.end > last.end) last.end = edit.end;
      last.replacement += edit.replacement;
      continue;
    }
    // 同一插入点（连续新增的一串字）：拼成一条，保持原始顺序
    if (last && edit.start === edit.end && last.start === last.end && edit.start === last.start) {
      last.replacement += edit.replacement;
      continue;
    }
    merged.push({ ...edit });
  }

  // 从后往前应用
  let raw = targetDoc.raw;
  let appliedText = 0;
  for (let i = merged.length - 1; i >= 0; i--) {
    const e = merged[i];
    if (e.start < 0 || e.end > raw.length || e.start > e.end) {
      skipped.push({ change: e.change, reason: '原文区间失效' });
      continue;
    }
    raw = raw.slice(0, e.start) + e.replacement + raw.slice(e.end);
    appliedText++;
  }

  const overrides: Record<string, string> = { ...(targetDoc.overrides ?? {}) };
  for (const [ch, reading] of readingByChar) overrides[ch] = reading;
  for (const ch of clearCharReadings) delete overrides[ch];
  const confirmed = [...new Set([...(targetDoc.confirmed ?? []), ...readingByChar.keys()])];

  return {
    doc: { ...targetDoc, raw, overrides, confirmed, updatedAt: Date.now() },
    applied: appliedText + readingByChar.size + clearCharReadings.size,
    skipped,
  };
}
