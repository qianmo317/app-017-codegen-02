/**
 * 版本对比引擎（纯函数，可独立测试）。
 *
 * 解决的问题：同一份盲文稿子改过几版后，逐页肉眼对照两版太慢。本引擎把两版按
 * 「语义单元」（一个汉字方带读音 / 一个数字 / 一个字母 / 一个标点）做两级对齐：
 *
 * 1. 段落级对齐：整段挪动位置（moved）、一段拆成两段（split）、几段合成一段（merge）
 *    属于结构位移，不算内容改动；
 * 2. 段内单元对齐：得到「新加方 / 删掉方 / 换读音」三类真实改动，每一条都给出
 *    在两版中各自的「第几页第几行第几方」。
 *
 * 两边差得太多（全局相似度低）或局部对不上号（长替换块内部几乎不重合）时，
 * 明确报告「错位 / 可能根本不是同一份稿子」，而不是硬凑成增删改动。
 */
import type { BrailleCell, Doc } from '../types';
import { convertText, type ConvertOptions } from './convert';
import { layoutDocument, type LayoutResult } from './layout';

/* ------------------------------------------------------------------ */
/* 数据模型                                                            */
/* ------------------------------------------------------------------ */

export type UnitKind = 'hanzi' | 'digit' | 'letter' | 'punct';
export type ReadingOrigin = 'override-word' | 'override-char' | 'default';

/** 语义单元：对齐与改动的最小粒度（一个汉字 = 一个带读音的单元） */
export interface DiffUnit {
  id: number;
  kind: UnitKind;
  /** 原文字面：汉字为单字，数字/字母/标点为该 token 的整串 */
  source: string;
  /** 汉字读音（带调数字，如 zhang3）；非汉字或无读音时为空 */
  reading: string;
  readingOrigin: ReadingOrigin;
  /** 该单元占用的全局方序号（见 DocModel.positions） */
  cellIds: number[];
  /** 在原文中的字符区间 [start, end)，用于搬移改动 */
  start: number;
  end: number;
  paraId: number;
  /** 在所属段落单元序列中的下标 */
  indexInPara: number;
}

export interface DiffParagraph {
  id: number;
  units: DiffUnit[];
}

export interface CellPos {
  page: number; // 1-based
  line: number; // 1-based
  cell: number; // 1-based
}

export interface DiffOptions {
  toneMode: ConvertOptions['toneMode'];
  autoDetectPinyin: boolean;
  dictEntries?: ConvertOptions['dictEntries'];
  showPageNumbers: boolean;
}

/** 一版稿子抽取出来的可对比模型 */
export interface DocModel {
  docId: string;
  /** 抽取所用的原文（搬移改动时按真实偏移切片，保留单元间空格等字符） */
  raw: string;
  paragraphs: DiffParagraph[];
  /** 全局单元（按文档顺序） */
  units: DiffUnit[];
  /** 全局方序号 → 页/行/方 */
  positions: Map<number, CellPos>;
  /** 方对象 → 全局方序号（UI 用对象身份查高亮） */
  cellIdByObject: Map<BrailleCell, number>;
  /** 全局方序号 → 方对象（反查） */
  cellObjectById: Map<number, BrailleCell>;
  layout: LayoutResult;
  /** 全局方总数（内容方，不含缩进/页码等注入方） */
  cellCount: number;
}

/* ------------------------------------------------------------------ */
/* 改动结果                                                            */
/* ------------------------------------------------------------------ */

export type ChangeKind = 'added' | 'removed' | 'reading';
export type StructuralKind = 'edit' | 'moved' | 'split' | 'merge';

export interface CellRef {
  cellId: number;
  pos: CellPos | null;
}

export interface DiffChange {
  id: string;
  kind: ChangeKind;
  /** 所在段落配对的结构性质：普通编辑 / 整段位移 / 拆分 / 合并 */
  structural: StructuralKind;
  /** 汉字（reading 类）或增删单元的字面 */
  source: string;
  /** reading：旧读音 */
  oldReading?: string;
  /** reading：新读音 */
  newReading?: string;
  /** 删除方：仅旧版有 */
  oldCells: CellRef[];
  /** 新加方 / 换读音方：仅新版有（reading 时指向新版那一方） */
  newCells: CellRef[];
  /** 局部对不上号：疑似错位而非真改动（见报告文案） */
  suspicious?: boolean;
  /** added：搬进旧版时在旧版 raw 的插入偏移；removed：在新版 raw 的插入偏移 */
  insertAt?: number;
  /** 所在旧版段落 id（拆分/合并时为多段） */
  oldPara: number[];
  newPara: number[];
}

export interface ParagraphEvent {
  type: 'moved' | 'split' | 'merge';
  /** 人类可读说明 */
  detail: string;
  oldParas: number[];
  newParas: number[];
  /** 纯位移（内部一字未改） */
  contentChanged: boolean;
}

export interface DiffWarning {
  level: 'error' | 'warn';
  message: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
  reading: number;
  moved: number;
  split: number;
  merge: number;
  /** 0~1，对齐上的内容占比（相似度） */
  similarity: number;
}

export interface DiffResult {
  changes: DiffChange[];
  events: ParagraphEvent[];
  warnings: DiffWarning[];
  summary: DiffSummary;
}

/* ------------------------------------------------------------------ */
/* 抽取模型                                                            */
/* ------------------------------------------------------------------ */

const HANZI_CHAR_RE = /[㐀-䶿一-鿿]/;

/**
 * 把一份文档转成可对比模型。
 * 注意：converted 里每个方对象在 paragraphs 与扁平 cells 中是同一引用；
 * 排版时缩进空方与页码方是新对象，不在此映射中，自然取不到位置。
 */
export function extractModel(doc: Doc, opts: DiffOptions): DocModel {
  const convertOpts: ConvertOptions = {
    toneMode: opts.toneMode,
    autoDetectPinyin: opts.autoDetectPinyin,
    profile: doc.ruleProfile,
    overrides: doc.overrides,
    confirmed: doc.confirmed,
    dictEntries: opts.dictEntries,
  };
  const converted = convertText(doc.raw, convertOpts);
  const layout = layoutDocument(converted.paragraphs, doc.setup, opts.showPageNumbers);

  // 1) 给每个内容方分配全局序号（对象身份映射）
  const cellIdOf = new Map<BrailleCell, number>();
  const cellOf = new Map<number, BrailleCell>();
  let nextCid = 0;
  for (const p of converted.paragraphs) {
    for (const w of p.words) {
      for (const c of w.cells) {
        if (!cellIdOf.has(c)) {
          cellIdOf.set(c, nextCid);
          cellOf.set(nextCid, c);
          nextCid++;
        }
      }
    }
  }

  // 2) 走排版结果，记录每个内容方落在 页/行/方
  const positions = new Map<number, CellPos>();
  layout.pages.forEach((page) => {
    page.lines.forEach((line, li) => {
      line.cells.forEach((cell, ci) => {
        const cid = cellIdOf.get(cell);
        if (cid !== undefined) positions.set(cid, { page: page.number, line: li + 1, cell: ci + 1 });
      });
    });
  });

  // 3) 行内 token 重扫以拿到原文偏移（tokenizeLine 不保留 offset）
  const rawLines = doc.raw.split('\n');
  const overrides = doc.overrides ?? {};

  const paragraphs: DiffParagraph[] = [];
  const units: DiffUnit[] = [];
  let uid = 0;
  let charCursor = 0; // doc.raw 中的绝对字符偏移

  converted.paragraphs.forEach((para, pi) => {
    const line = rawLines[pi] ?? '';
    const dpara: DiffParagraph = { id: pi, units: [] };
    const pushUnit = (u: Omit<DiffUnit, 'id' | 'paraId' | 'indexInPara'>) => {
      const unit: DiffUnit = { ...u, id: uid++, paraId: pi, indexInPara: dpara.units.length };
      dpara.units.push(unit);
      units.push(unit);
    };
    if (!para.blank) {
      let searchFrom = 0;
      for (const word of para.words) {
        // 在行内定位该 token（标点/数字/字母串在原文中连续；重复 token 取靠后未用位置）
        const tokenText = word.source;
        const start = tokenText ? Math.max(line.indexOf(tokenText, searchFrom), searchFrom) : searchFrom;
        const absStart = charCursor + start;
        searchFrom = start + tokenText.length;

        const allHanzi = word.cells.length > 0 && word.cells.every((c) => c.kind === 'hanzi');
        const chars = [...tokenText];
        const wordOverridden = overrides[tokenText] !== undefined;

        if (allHanzi && chars.length > 1) {
          // 多字词逐字建单元：转换期每字产出 1~2 个方，且只在该字最后一方挂 reading；
          // 未收录字是单个空方（uncertain）。据此把方序列按字分组。
          let cellCursor = 0;
          chars.forEach((ch, chi) => {
            const own: BrailleCell[] = [];
            const first = word.cells[cellCursor];
            if (first && first.dots.length === 0) {
              own.push(first);
              cellCursor++;
            } else {
              while (cellCursor < word.cells.length) {
                const c = word.cells[cellCursor++];
                own.push(c);
                if (c.reading !== undefined && c.reading !== '') break;
              }
            }
            const reading =
              [...own].reverse().find((c) => c.reading !== undefined && c.reading !== '')?.reading ?? '';
            pushUnit({
              kind: 'hanzi',
              source: ch,
              reading,
              readingOrigin: wordOverridden
                ? 'override-word'
                : overrides[ch] !== undefined
                  ? 'override-char'
                  : 'default',
              cellIds: own.map((c) => cellIdOf.get(c)!).filter((v) => v !== undefined),
              start: absStart + chi,
              end: absStart + chi + 1,
            });
          });
        } else {
          // 单字 / 数字串 / 字母串 / 标点：一个 token 一个单元
          const cellKinds = word.cells.map((c) => c.kind);
          const hasHanzi = chars.some((ch) => HANZI_CHAR_RE.test(ch));
          const kind: UnitKind =
            allHanzi || hasHanzi
              ? 'hanzi'
              : cellKinds.includes('digit')
                ? 'digit'
                : cellKinds.includes('letter')
                  ? 'letter'
                  : 'punct';
          const onlyChar = chars.length === 1 ? chars[0] : '';
          pushUnit({
            kind,
            source: tokenText,
            reading:
              [...word.cells].reverse().find((c) => c.reading !== undefined && c.reading !== '')?.reading ?? '',
            readingOrigin: wordOverridden
              ? 'override-word'
              : onlyChar && overrides[onlyChar] !== undefined
                ? 'override-char'
                : 'default',
            cellIds: word.cells.map((c) => cellIdOf.get(c)!).filter((v) => v !== undefined),
            start: absStart,
            end: charCursor + searchFrom,
          });
        }
      }
    }
    paragraphs.push(dpara);
    charCursor += line.length + 1; // 计入 '\n'
  });

  return {
    docId: doc.id,
    raw: doc.raw,
    paragraphs,
    units,
    positions,
    cellIdByObject: cellIdOf,
    cellObjectById: cellOf,
    layout,
    cellCount: nextCid,
  };
}

/* ------------------------------------------------------------------ */
/* 单元比较                                                            */
/* ------------------------------------------------------------------ */

/** 同字同类才算对齐得上（汉字读音变化仍对齐为同一字） */
function unitsAlignable(a: DiffUnit, b: DiffUnit): boolean {
  if (a.kind !== b.kind) return false;
  return a.source === b.source;
}

interface PairOp {
  type: 'equal' | 'reading' | 'oldonly' | 'newonly';
  old?: DiffUnit;
  new?: DiffUnit;
  suspicious?: boolean;
  /** newonly 块要插入旧版时，在旧版原文中的插入偏移（前一个对齐单元之后） */
  insertAtOld?: number;
  /** oldonly 块要插回新版时，在新版原文中的插入偏移 */
  insertAtNew?: number;
}

/** 段内单元 LCS 对齐：最大化同字/同 token 对数 */
function alignUnits(oldUnits: DiffUnit[], newUnits: DiffUnit[]): PairOp[] {
  const n = oldUnits.length;
  const m = newUnits.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      if (unitsAlignable(oldUnits[i], newUnits[j])) {
        dp[i][j] = Math.max(dp[i][j], dp[i + 1][j + 1] + 1);
      }
    }
  }
  const ops: PairOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (unitsAlignable(oldUnits[i], newUnits[j]) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      const type: PairOp['type'] =
        oldUnits[i].kind === 'hanzi' && oldUnits[i].reading !== newUnits[j].reading ? 'reading' : 'equal';
      ops.push({ type, old: oldUnits[i], new: newUnits[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'oldonly', old: oldUnits[i] });
      i++;
    } else {
      ops.push({ type: 'newonly', new: newUnits[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'oldonly', old: oldUnits[i++] });
  while (j < m) ops.push({ type: 'newonly', new: newUnits[j++] });

  // 为连续新增/删除块标注「对侧插入点」：前一个对齐单元之后、后一个对齐单元之前。
  // 块位于段首时锚点取该段在旧/新版的起始位置。
  const oldParaStart = oldUnits.length ? oldUnits[0].start : 0;
  const newParaStart = newUnits.length ? newUnits[0].start : 0;
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type !== 'oldonly' && ops[k].type !== 'newonly') continue;
    let e = k;
    while (e < ops.length && (ops[e].type === 'oldonly' || ops[e].type === 'newonly')) e++;
    const prev = k > 0 ? ops[k - 1] : undefined;
    const next = e < ops.length ? ops[e] : undefined;
    const atOld = prev?.old ? prev.old.end : next?.old ? next.old.start : oldParaStart;
    const atNew = prev?.new ? prev.new.end : next?.new ? next.new.start : newParaStart;
    for (let t = k; t < e; t++) {
      ops[t].insertAtOld = atOld;
      ops[t].insertAtNew = atNew;
    }
    k = e - 1;
  }

  markSuspiciousBlocks(ops);
  return ops;
}

/** 相邻的 oldonly/newonly 构成一个替换块；块内字面几乎不重合 → 疑似对不上号 */
function markSuspiciousBlocks(ops: PairOp[]) {
  const SIMILAR = 0.25;
  const MIN_BLOCK = 3;
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type !== 'oldonly' && ops[k].type !== 'newonly') {
      k++;
      continue;
    }
    let e = k;
    while (e < ops.length && (ops[e].type === 'oldonly' || ops[e].type === 'newonly')) e++;
    const block = ops.slice(k, e);
    const oldS = block.filter((o) => o.type === 'oldonly').map((o) => o.old!.source).join('');
    const newS = block.filter((o) => o.type === 'newonly').map((o) => o.new!.source).join('');
    if (block.length >= MIN_BLOCK && charSimilarity(oldS, newS) < SIMILAR) {
      block.forEach((o) => (o.suspicious = true));
    }
    k = e;
  }
}

/** 字面重合度：公共字符计数（多重集交）/ 较长串长度 */
export function charSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  const count = new Map<string, number>();
  for (const ch of a) count.set(ch, (count.get(ch) ?? 0) + 1);
  let common = 0;
  for (const ch of b) {
    const left = count.get(ch) ?? 0;
    if (left > 0) {
      common++;
      count.set(ch, left - 1);
    }
  }
  return common / longer;
}

/* ------------------------------------------------------------------ */
/* 段落级对齐                                                          */
/* ------------------------------------------------------------------ */

type ParaSig = string[];

function paraSignature(p: DiffParagraph): ParaSig {
  return p.units.map((u) => `${u.kind}:${u.source}`);
}

/** 单元序列的 shingle 多重集（unigram + bigram；短序列退化为 unigram） */
function shingleBag(sig: ParaSig, k: number): Map<string, number> {
  const out = new Map<string, number>();
  const add = (s: string) => out.set(s, (out.get(s) ?? 0) + 1);
  for (const s of sig) add(`u:${s}`);
  if (sig.length >= k) {
    for (let i = 0; i + k <= sig.length; i++) add(`b:${sig.slice(i, i + k).join('|')}`);
  }
  return out;
}

function sumCount(bag: Map<string, number>): number {
  let s = 0;
  for (const v of bag.values()) s += v;
  return s;
}

/**
 * 配对相似度（对「在一段里插入/删除几个单元」友好）：
 * overlap 系数 = 公共 shingle 数 / min(两侧 shingle 数)。
 * 「你好世界」被「你好美丽世界」包含这种关系可得高分，不会因插入而配不上对。
 */
function overlapSimilarity(parasA: DiffParagraph[], parasB: DiffParagraph[]): number {
  const bagA = new Map<string, number>();
  const bagB = new Map<string, number>();
  for (const p of parasA)
    for (const [k, v] of shingleBag(paraSignature(p), 2)) bagA.set(k, (bagA.get(k) ?? 0) + v);
  for (const p of parasB)
    for (const [k, v] of shingleBag(paraSignature(p), 2)) bagB.set(k, (bagB.get(k) ?? 0) + v);
  let inter = 0;
  for (const [k, va] of bagA) inter += Math.min(va, bagB.get(k) ?? 0);
  const denom = Math.min(sumCount(bagA), sumCount(bagB));
  return denom === 0 ? 1 : inter / denom;
}

interface PairGroup {
  old: number[];
  new: number[];
}

const PAIR_SIMILAR = 0.45;
const MAX_GROUP = 4;

/**
 * 段落级对齐：
 * 第一遍——整段指纹完全相同的段落按多重集配对（无论挪到哪里 → moved）；
 * 第二遍——剩余段落保序做 1↔k / k↔1 分组 DP（编辑 / 拆分 / 合并），
 * 配对代价 = 1 − 相似度，配不上对的整段按新增/删除处理。
 */
function alignParagraphs(oldPs: DiffParagraph[], newPs: DiffParagraph[]): PairGroup[] {
  const oldUsed = new Array(oldPs.length).fill(false);
  const newUsed = new Array(newPs.length).fill(false);
  const groups: PairGroup[] = [];

  // 第一遍：完全相同段落（多重集，按出现次序配对）
  const newBySig = new Map<string, number[]>();
  newPs.forEach((p, idx) => {
    const key = paraSignature(p).join(' ');
    if (!newBySig.has(key)) newBySig.set(key, []);
    newBySig.get(key)!.push(idx);
  });
  oldPs.forEach((p, oi) => {
    const key = paraSignature(p).join(' ');
    const list = newBySig.get(key);
    if (!list) return;
    const ni = list.shift();
    if (ni !== undefined && !oldUsed[oi]) {
      oldUsed[oi] = true;
      newUsed[ni] = true;
      groups.push({ old: [oi], new: [ni] });
    }
  });

  // 第二遍：剩余保序 DP
  const oi2 = oldPs.map((_, i) => i).filter((i) => !oldUsed[i]);
  const ni2 = newPs.map((_, i) => i).filter((i) => !newUsed[i]);

  const simCache = new Map<string, number>();
  const sim = (oa: number[], na: number[]): number =>
    overlapSimilarity(oa.map((x) => oldPs[x]), na.map((x) => newPs[x]));
  const simKey = (oa: number[], na: number[]) => `${oa.join('.')}>${na.join('.')}`;

  const R = oi2.length;
  const C = ni2.length;
  const dp: number[][] = Array.from({ length: R + 1 }, () => new Array<number>(C + 1).fill(0));
  const choice: ({ og: number[]; ng: number[] })[][] = Array.from({ length: R + 1 }, () =>
    new Array(C + 1).fill(null),
  );
  for (let i = R - 1; i >= 0; i--) dp[i][C] = dp[i + 1][C] + 1;
  for (let j = C - 1; j >= 0; j--) dp[R][j] = dp[R][j + 1] + 1;
  for (let i = R - 1; i >= 0; i--) {
    for (let j = C - 1; j >= 0; j--) {
      let best = dp[i + 1][j] + 1; // 旧段删除
      let bestChoice: { og: number[]; ng: number[] } = { og: [oi2[i]], ng: [] };
      const candNew = dp[i][j + 1] + 1; // 新段新增
      if (candNew < best) {
        best = candNew;
        bestChoice = { og: [], ng: [ni2[j]] };
      }
      for (let ol = 1; ol <= MAX_GROUP && i + ol <= R; ol++) {
        const og = oi2.slice(i, i + ol);
        for (let nl = 1; nl <= MAX_GROUP && j + nl <= C; nl++) {
          const ng = ni2.slice(j, j + nl);
          const key = simKey(og, ng);
          let s = simCache.get(key);
          if (s === undefined) {
            s = sim(og, ng);
            simCache.set(key, s);
          }
          if (s >= PAIR_SIMILAR) {
            const cand = dp[i + ol][j + nl] + (1 - s) * Math.max(og.length, ng.length);
            if (cand < best) {
              best = cand;
              bestChoice = { og, ng };
            }
          }
        }
      }
      dp[i][j] = best;
      choice[i][j] = bestChoice;
    }
  }

  const paired: PairGroup[] = [];
  let i = 0;
  let j = 0;
  while (i < R || j < C) {
    if (i === R) {
      paired.push({ old: [], new: [ni2[j]] });
      j++;
      continue;
    }
    if (j === C) {
      paired.push({ old: [oi2[i]], new: [] });
      i++;
      continue;
    }
    const ch = choice[i][j];
    paired.push({ old: ch.og, new: ch.ng });
    i += ch.og.length;
    j += ch.ng.length;
  }
  groups.push(...paired);
  groups.sort((a, b) => (a.old[0] ?? Number.MAX_SAFE_INTEGER) - (b.old[0] ?? Number.MAX_SAFE_INTEGER));
  return groups;
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

let changeSeq = 0;

export function compareDocs(oldModel: DocModel, newModel: DocModel): DiffResult {
  const oldPs = oldModel.paragraphs.filter((p) => p.units.length > 0);
  const newPs = newModel.paragraphs.filter((p) => p.units.length > 0);
  const oldIdByIdx = oldPs.map((p) => p.id);
  const newIdByIdx = newPs.map((p) => p.id);

  const groups = alignParagraphs(oldPs, newPs);
  const changes: DiffChange[] = [];
  const events: ParagraphEvent[] = [];
  const warnings: DiffWarning[] = [];
  let matchedUnits = 0;
  let totalUnits = 0;
  let movedN = 0;
  let splitN = 0;
  let mergeN = 0;

  const refOf = (model: DocModel, u: DiffUnit): CellRef[] =>
    u.cellIds.map((cid) => ({ cellId: cid, pos: model.positions.get(cid) ?? null }));

  for (const g of groups) {
    const oldUnits = g.old.flatMap((idx) => oldPs[idx].units);
    const newUnits = g.new.flatMap((idx) => newPs[idx].units);
    totalUnits += oldUnits.length + newUnits.length;
    const oldParaIds = g.old.map((idx) => oldIdByIdx[idx]);
    const newParaIds = g.new.map((idx) => newIdByIdx[idx]);

    const isPair = g.old.length > 0 && g.new.length > 0;
    const split = g.old.length === 1 && g.new.length > 1;
    const merge = g.new.length === 1 && g.old.length > 1;
    const identical =
      g.old.length === 1 &&
      g.new.length === 1 &&
      paraSignature(oldPs[g.old[0]]).join(' ') === paraSignature(newPs[g.new[0]]).join(' ');
    const moved = identical && g.old[0] !== g.new[0];
    const structural: StructuralKind = moved ? 'moved' : split ? 'split' : merge ? 'merge' : 'edit';

    if (isPair) {
      if (split) splitN++;
      if (merge) mergeN++;
      if (moved) movedN++;
      if (split || merge || moved) {
        const probeOps = alignUnits(oldUnits, newUnits);
        const contentChanged = probeOps.some(
          (op) => op.type === 'reading' || op.type === 'oldonly' || op.type === 'newonly',
        );
        events.push({
          type: moved ? 'moved' : split ? 'split' : 'merge',
          detail: moved
            ? `整段从第 ${g.old[0] + 1} 段移到第 ${g.new[0] + 1} 段${contentChanged ? '，段内另有改动' : '，内容未改'}`
            : split
              ? `第 ${g.old[0] + 1} 段拆成 ${g.new.length} 段（第 ${g.new.map((x) => x + 1).join('、')} 段）${contentChanged ? '，段内另有改动' : ''}`
              : `第 ${g.old.map((x) => x + 1).join('、')} 段合成一段（第 ${g.new[0] + 1} 段）${contentChanged ? '，段内另有改动' : ''}`,
          oldParas: oldParaIds,
          newParas: newParaIds,
          contentChanged,
        });
      }

      const ops = alignUnits(oldUnits, newUnits);
      for (const op of ops) {
        if (op.type === 'equal') {
          matchedUnits += 2;
          continue;
        }
        if (op.type === 'reading') {
          matchedUnits += 2;
          changes.push({
            id: `c${changeSeq++}`,
            kind: 'reading',
            structural,
            source: op.new!.source,
            oldReading: op.old!.reading,
            newReading: op.new!.reading,
            oldCells: refOf(oldModel, op.old!),
            newCells: refOf(newModel, op.new!),
            oldPara: oldParaIds,
            newPara: newParaIds,
          });
        } else if (op.type === 'oldonly') {
          changes.push({
            id: `c${changeSeq++}`,
            kind: 'removed',
            structural,
            source: op.old!.source,
            oldCells: refOf(oldModel, op.old!),
            newCells: [],
            suspicious: op.suspicious,
            insertAt: op.insertAtNew,
            oldPara: oldParaIds,
            newPara: newParaIds,
          });
        } else {
          changes.push({
            id: `c${changeSeq++}`,
            kind: 'added',
            structural,
            source: op.new!.source,
            oldCells: [],
            newCells: refOf(newModel, op.new!),
            suspicious: op.suspicious,
            insertAt: op.insertAtOld,
            oldPara: oldParaIds,
            newPara: newParaIds,
          });
        }
      }
    } else {
      // 配不上对的整段：整段新增 / 整段删除
      for (const u of oldUnits) {
        changes.push({
          id: `c${changeSeq++}`,
          kind: 'removed',
          structural: 'edit',
          source: u.source,
          oldCells: refOf(oldModel, u),
          newCells: [],
          oldPara: oldParaIds,
          newPara: [],
        });
      }
      for (const u of newUnits) {
        changes.push({
          id: `c${changeSeq++}`,
          kind: 'added',
          structural: 'edit',
          source: u.source,
          newCells: refOf(newModel, u),
          oldCells: [],
          oldPara: [],
          newPara: newParaIds,
        });
      }
    }
  }

  const similarity = totalUnits === 0 ? 1 : matchedUnits / totalUnits;

  const oldN = oldModel.units.length;
  const newN = newModel.units.length;
  if (similarity < 0.34) {
    warnings.push({
      level: 'error',
      message:
        '两版只有很少内容能对上号——这很可能不是同一份稿子的两个版本（选错了文档），或其中一版被整体重写。下面的增删条目请按「疑似错位」谨慎对待。',
    });
  } else if (similarity < 0.6) {
    warnings.push({
      level: 'warn',
      message:
        '两版差异较大（超过四成对不上），已尽力按上下文对齐；请重点核对标注「疑似错位」的条目，确认是真改动还是段落错位。',
    });
  }
  if (oldN > 0 && newN > 0 && (oldN > newN * 4 || newN > oldN * 4)) {
    warnings.push({
      level: 'warn',
      message: `两版篇幅相差悬殊（旧版约 ${oldN} 个单元，新版约 ${newN} 个），部分位置可能只是长度变化引起的错位。`,
    });
  }
  const suspiciousN = changes.filter((c) => c.suspicious).length;
  if (suspiciousN > 0 && similarity >= 0.6) {
    warnings.push({
      level: 'warn',
      message: `有 ${suspiciousN} 处改动落在对不太上号的区域（疑似错位，已逐条标注），建议跳到对应页码人工确认后再搬移。`,
    });
  }

  const summary: DiffSummary = {
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
    reading: changes.filter((c) => c.kind === 'reading').length,
    moved: movedN,
    split: splitN,
    merge: mergeN,
    similarity,
  };

  return { changes, events, warnings, summary };
}

/* ------------------------------------------------------------------ */
/* 文案与定位辅助                                                       */
/* ------------------------------------------------------------------ */

export function formatPos(ref: CellRef | null | undefined): string {
  if (!ref || !ref.pos) return '位置不可用';
  return `第 ${ref.pos.page} 页第 ${ref.pos.line} 行第 ${ref.pos.cell} 方`;
}

export function changeText(c: DiffChange): string {
  if (c.kind === 'reading') {
    return `换读音：「${c.source}」${c.oldReading || '（无读音）'} → ${c.newReading || '（无读音）'}`;
  }
  if (c.kind === 'added') return `新加：${c.source}`;
  return `删除：${c.source}`;
}

/** 该改动在某一侧（old/new）的首个定位，用于预览跳转 */
export function changeLocation(c: DiffChange, side: 'old' | 'new'): CellPos | null {
  const refs = side === 'old' ? c.oldCells : c.newCells;
  return refs.find((r) => r.pos)?.pos ?? null;
}

