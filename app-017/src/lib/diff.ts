/**
 * 版本对比引擎：分层比对两份文档，找出新增 / 删除 / 换读音的改动。
 *
 * 设计要点：
 * - 先按段落对齐（同文段落原位/换位配对、一段拆多段、多段并一段都能识别），
 *   再在段落内部逐字对齐——整段挪位置、段落拆分/合并不计为改动；
 * - 对齐只按「来源字符」，读音/点字差异在对齐后比较——换读音不算增删；
 * - 对不上号时给出判断：完全对不上＝真改；勉强对上的段落标注「疑似错位」；
 * - 每条改动携带「第几页第几行第几方」位置与原文偏移，可逐条挑选并应用到另一版。
 */
import type { BrailleCell, Doc } from '../types';
import { convertText, type ConvertOptions, type ConvertResult } from './convert';
import { layoutDocument, type LayoutResult } from './layout';
import { tokenizeLine } from './segment';

/** 比对用的最小单位：一个来源字符（拼音直输时为一个音节串）及其点字 */
export interface DiffToken {
  /** 来源字符 */
  text: string;
  /** 点字签名（kind + 点位，读音/声调变化会改变签名） */
  sig: string;
  /** 读音（无则空串） */
  reading: string;
  /** 段落序号（空行不计） */
  para: number;
  /** 在原文 raw 中的偏移 */
  rawStart: number;
  rawEnd: number;
  /** 该字第一个方的引用（用于在版面中定位） */
  cell: BrailleCell | null;
}

export interface CellLoc {
  page: number;
  line: number;
  cell: number;
}

export type ChangeKind = 'added' | 'deleted' | 'modified';

export interface ChangeItem {
  id: string;
  kind: ChangeKind;
  /** 涉及文本（换读音时为该字） */
  text: string;
  readingA?: string;
  readingB?: string;
  /** 位置：删除→版本A；新增→版本B；换读音→两边都有 */
  locA?: CellLoc;
  locB?: CellLoc;
  /** 应用所需：原文偏移与插入文本 */
  aStart?: number;
  aEnd?: number;
  bStart?: number;
  bEnd?: number;
  insertAfterA?: number;
  insertTextA?: string;
  insertAfterB?: number;
  insertTextB?: string;
  /** 块在源版本中是否紧挨段落边界（应用时决定是否补换行） */
  paraBefore?: boolean;
  paraAfter?: boolean;
  /** 换读音的字（单字才能写回覆盖） */
  char?: string;
}

export interface InfoItem {
  kind: 'moved' | 'split' | 'merged';
  text: string;
  /** 拆分/合并的段数 */
  detail?: string;
  locA?: CellLoc;
  locB?: CellLoc;
}

export interface DiffResult {
  changes: ChangeItem[];
  /** 移动 / 段落拆分合并（不计为改动） */
  infos: InfoItem[];
  /** 错位 / 差异过大 / 无法对齐等提示 */
  warnings: string[];
  stats: {
    added: number;
    deleted: number;
    modified: number;
    /** 内容对应率（0-1），过低说明可能选错版本 */
    alignRatio: number;
  };
}

const cellSig = (c: BrailleCell) => `${c.kind}:${c.dots.join('.')}`;

/** 文档 → 逐字 token 序列（携带原文偏移与方引用）；conv 可传入已算好的转换结果以复用方引用 */
export function buildTokens(raw: string, opts: ConvertOptions, conv?: ConvertResult): DiffToken[] {
  const converted = conv ?? convertText(raw, opts);
  const tokens: DiffToken[] = [];
  let para = 0;
  let offset = 0;
  const lines = raw.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const p = converted.paragraphs[li];
    if (line.trim() === '' || !p || p.blank) {
      offset += line.length + 1;
      continue;
    }
    const words = tokenizeLine(line);
    let cursor = 0;
    for (let wi = 0; wi < words.length; wi++) {
      const wText = words[wi].text;
      const wc = p.words[wi];
      const at = line.indexOf(wText, cursor);
      const start = offset + (at >= 0 ? at : cursor);
      cursor = (at >= 0 ? at : cursor) + wText.length;
      // 词内的方按来源字符（srcPos）归并成字
      const groups = new Map<number, BrailleCell[]>();
      for (const c of wc.cells) {
        const k = c.srcPos ?? 0;
        const g = groups.get(k);
        if (g) g.push(c);
        else groups.set(k, [c]);
      }
      for (const k of [...groups.keys()].sort((x, y) => x - y)) {
        const cells = groups.get(k)!;
        const first = cells[0];
        const text = first.source ?? wText[k] ?? '';
        tokens.push({
          text,
          sig: cells.map(cellSig).join('|'),
          reading: cells.map((c) => c.reading ?? '').join(''),
          para,
          rawStart: start + k,
          rawEnd: start + k + text.length,
          cell: first,
        });
      }
    }
    para++;
    offset += line.length + 1;
  }
  return tokens;
}

/* ---------- 通用对齐：公共前后缀 + 唯一锚点（patience）+ 小区间 DP ---------- */

const DP_THRESHOLD = 200_000;

function dpAlign<T>(
  a: T[],
  a0: number,
  a1: number,
  b: T[],
  b0: number,
  b1: number,
  key: (t: T) => string,
  matchA: (number | null)[],
  matchB: (number | null)[],
) {
  const na = a1 - a0;
  const nb = b1 - b0;
  const W = nb + 1;
  const dp = new Uint32Array((na + 1) * W);
  for (let i = na - 1; i >= 0; i--) {
    const ka = key(a[a0 + i]);
    for (let j = nb - 1; j >= 0; j--) {
      dp[i * W + j] =
        ka === key(b[b0 + j])
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < na && j < nb) {
    if (key(a[a0 + i]) === key(b[b0 + j])) {
      matchA[a0 + i] = b0 + j;
      matchB[b0 + j] = a0 + i;
      i++;
      j++;
    } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
}

/** 最长递增子序列（返回下标序列） */
function longestIncreasing(seq: number[]): number[] {
  const tails: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  const out: number[] = [];
  let cur = tails.length ? tails[tails.length - 1] : -1;
  while (cur >= 0) {
    out.push(cur);
    cur = prev[cur];
  }
  return out.reverse();
}

function alignRange<T>(
  a: T[],
  a0: number,
  a1: number,
  b: T[],
  b0: number,
  b1: number,
  key: (t: T) => string,
  matchA: (number | null)[],
  matchB: (number | null)[],
) {
  if (a0 >= a1 || b0 >= b1) return;
  const na = a1 - a0;
  const nb = b1 - b0;
  if (na * nb <= DP_THRESHOLD) {
    dpAlign(a, a0, a1, b, b0, b1, key, matchA, matchB);
    return;
  }
  // 双方都只出现一次的元素作为锚点
  const countA = new Map<string, number>();
  for (let i = a0; i < a1; i++) {
    const k = key(a[i]);
    countA.set(k, (countA.get(k) ?? 0) + 1);
  }
  const countB = new Map<string, number>();
  const posB = new Map<string, number>();
  for (let j = b0; j < b1; j++) {
    const k = key(b[j]);
    countB.set(k, (countB.get(k) ?? 0) + 1);
    posB.set(k, j);
  }
  const anchors: [number, number][] = [];
  for (let i = a0; i < a1; i++) {
    const k = key(a[i]);
    if (countA.get(k) === 1 && countB.get(k) === 1) anchors.push([i, posB.get(k)!]);
  }
  if (anchors.length === 0) return; // 整段对不上：留作增删，由上层提示
  let pa = a0;
  let pb = b0;
  for (const idx of longestIncreasing(anchors.map(([, j]) => j))) {
    const [i, j] = anchors[idx];
    alignRange(a, pa, i, b, pb, j, key, matchA, matchB);
    matchA[i] = j;
    matchB[j] = i;
    pa = i + 1;
    pb = j + 1;
  }
  alignRange(a, pa, a1, b, pb, b1, key, matchA, matchB);
}

/** 对齐两个序列的指定区间（含公共前后缀修剪） */
function alignSub<T>(
  a: T[],
  a0: number,
  a1: number,
  b: T[],
  b0: number,
  b1: number,
  key: (t: T) => string,
  matchA: (number | null)[],
  matchB: (number | null)[],
) {
  while (a0 < a1 && b0 < b1 && key(a[a0]) === key(b[b0])) {
    matchA[a0] = b0;
    matchB[b0] = a0;
    a0++;
    b0++;
  }
  while (a1 > a0 && b1 > b0 && key(a[a1 - 1]) === key(b[b1 - 1])) {
    a1--;
    b1--;
    matchA[a1] = b1;
    matchB[b1] = a1;
  }
  alignRange(a, a0, a1, b, b0, b1, key, matchA, matchB);
}

/* ---------- 段落层 ---------- */

interface Para {
  key: string;
  start: number;
  end: number;
}

function groupParas(tokens: DiffToken[]): Para[] {
  const paras: Para[] = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    while (j < tokens.length && tokens[j].para === tokens[i].para) j++;
    paras.push({ key: joinText(tokens, i, j), start: i, end: j });
    i = j;
  }
  return paras;
}

/** 两个文本序列的 LCS 长度（滚动数组） */
function lcsLength(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const row = new Uint32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

/* ---------- 移动块配对（字级，段落内/跨段落）：整段挪位置不算改动 ---------- */

interface Run {
  start: number;
  end: number;
}

function runsOf(unmatched: boolean[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < unmatched.length) {
    if (!unmatched[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < unmatched.length && unmatched[j]) j++;
    runs.push({ start: i, end: j });
    i = j;
  }
  return runs;
}

const joinText = (tokens: DiffToken[], s: number, e: number) => tokens.slice(s, e).map((t) => t.text).join('');

/** 两段 token 文本的最长公共子串 */
function longestCommonSlice(ta: DiffToken[], a0: number, a1: number, tb: DiffToken[], b0: number, b1: number) {
  const na = a1 - a0;
  const nb = b1 - b0;
  let best = 0;
  let bestA = 0;
  let bestB = 0;
  let prevRow = new Uint32Array(nb + 1);
  for (let i = 1; i <= na; i++) {
    const row = new Uint32Array(nb + 1);
    const ta_i = ta[a0 + i - 1].text;
    for (let j = 1; j <= nb; j++) {
      if (ta_i === tb[b0 + j - 1].text) {
        row[j] = prevRow[j - 1] + 1;
        if (row[j] > best) {
          best = row[j];
          bestA = a0 + i - best;
          bestB = b0 + j - best;
        }
      }
    }
    prevRow = row;
  }
  return { len: best, aStart: bestA, bStart: bestB };
}

const MIN_MOVE_EXACT = 2; // 完全相同的移动块最小长度
const MIN_MOVE_SLICE = 4; // 块内子串配对的最小长度（防止误配）

function pairMoves(
  tokensA: DiffToken[],
  tokensB: DiffToken[],
  matchA: (number | null)[],
  matchB: (number | null)[],
  infos: InfoItem[],
  locateA: (t: DiffToken) => CellLoc | undefined,
  locateB: (t: DiffToken) => CellLoc | undefined,
) {
  const unmatchedA = matchA.map((m) => m === null);
  const unmatchedB = matchB.map((m) => m === null);

  const pair = (aS: number, aE: number, bS: number, bE: number, record: boolean) => {
    const len = aE - aS;
    for (let k = 0; k < len; k++) {
      matchA[aS + k] = bS + k;
      matchB[bS + k] = aS + k;
      unmatchedA[aS + k] = false;
      unmatchedB[bS + k] = false;
    }
    if (record && len >= MIN_MOVE_EXACT) {
      infos.push({
        kind: 'moved',
        text: joinText(tokensA, aS, aE),
        locA: locateA(tokensA[aS]),
        locB: locateB(tokensB[bS]),
      });
    }
  };

  for (let round = 0; round < 500; round++) {
    const delRuns = runsOf(unmatchedA);
    const insRuns = runsOf(unmatchedB);
    if (delRuns.length === 0 || insRuns.length === 0) return;
    // 1) 完全相同的块（任意长度，先长后短）
    let done = false;
    const exact: { len: number; d: Run; i: Run }[] = [];
    for (const d of delRuns) {
      const dText = joinText(tokensA, d.start, d.end);
      for (const s of insRuns) {
        if (d.end - d.start === s.end - s.start && dText === joinText(tokensB, s.start, s.end)) {
          exact.push({ len: d.end - d.start, d, i: s });
          break;
        }
      }
    }
    exact.sort((x, y) => y.len - x.len);
    for (const { d, i } of exact) {
      if (!unmatchedA[d.start] || !unmatchedB[i.start]) continue;
      pair(d.start, d.end, i.start, i.end, true);
      done = true;
    }
    if (done) continue;
    // 2) 块内子串配对（移动后又改了几个字的情况）：子串 ≥4 且占较短块 ≥80%
    let bestSlice: { len: number; aStart: number; bStart: number } | null = null;
    for (const d of delRuns) {
      for (const s of insRuns) {
        const shorter = Math.min(d.end - d.start, s.end - s.start);
        if (shorter < MIN_MOVE_SLICE) continue;
        const cand = longestCommonSlice(tokensA, d.start, d.end, tokensB, s.start, s.end);
        if (cand.len >= MIN_MOVE_SLICE && cand.len >= shorter * 0.8) {
          if (!bestSlice || cand.len > bestSlice.len) bestSlice = cand;
        }
      }
    }
    if (bestSlice) {
      pair(bestSlice.aStart, bestSlice.aStart + bestSlice.len, bestSlice.bStart, bestSlice.bStart + bestSlice.len, true);
      continue;
    }
    return;
  }
}

/* ---------- 位置 ---------- */

function locateCell(layout: LayoutResult, cell: BrailleCell | null): CellLoc | undefined {
  if (!cell) return undefined;
  for (const p of layout.pages) {
    for (let li = 0; li < p.lines.length; li++) {
      const idx = p.lines[li].cells.indexOf(cell);
      if (idx >= 0) return { page: p.number, line: li + 1, cell: idx + 1 };
    }
  }
  return undefined;
}

/* ---------- 主流程 ---------- */

/** 段落模糊配对的阈值 */
const FUZZY_MIN = 0.35; // 1:1 接受的最低相似度（低于此值视为真改）
const FUZZY_CONFIDENT = 0.6; // 1:1 置信阈值（介于两者之间标「疑似错位」）
const CONCAT_MIN = 0.5; // 1:N 覆盖率下限
const CONCAT_CONFIDENT = 0.8;
const MAX_PARTS = 4;

export function diffDocuments(
  docA: Doc,
  docB: Doc,
  optsA: ConvertOptions,
  optsB: ConvertOptions,
  showPageNumbers: boolean,
): DiffResult {
  const convA = convertText(docA.raw, optsA);
  const convB = convertText(docB.raw, optsB);
  const tokensA = buildTokens(docA.raw, optsA, convA);
  const tokensB = buildTokens(docB.raw, optsB, convB);
  // 排版与 token 共用同一次转换结果，方引用才能对上号
  const layoutA = layoutDocument(convA.paragraphs, docA.setup, showPageNumbers);
  const layoutB = layoutDocument(convB.paragraphs, docB.setup, showPageNumbers);
  const locateA = (t: DiffToken) => locateCell(layoutA, t.cell);
  const locateB = (t: DiffToken) => locateCell(layoutB, t.cell);

  const matchA: (number | null)[] = new Array(tokensA.length).fill(null);
  const matchB: (number | null)[] = new Array(tokensB.length).fill(null);
  const infos: InfoItem[] = [];
  const warnings: string[] = [];

  const parasA = groupParas(tokensA);
  const parasB = groupParas(tokensB);
  const pairedA = new Set<number>();
  const pairedB = new Set<number>();

  const pairExact = (pa: Para, pb: Para) => {
    const len = Math.min(pa.end - pa.start, pb.end - pb.start);
    for (let k = 0; k < len; k++) {
      matchA[pa.start + k] = pb.start + k;
      matchB[pb.start + k] = pa.start + k;
    }
  };

  // 1) 段落骨架：同文段落原位对齐
  {
    const pmA: (number | null)[] = new Array(parasA.length).fill(null);
    const pmB: (number | null)[] = new Array(parasB.length).fill(null);
    alignSub(parasA, 0, parasA.length, parasB, 0, parasB.length, (p) => p.key, pmA, pmB);
    for (let i = 0; i < parasA.length; i++) {
      const j = pmA[i];
      if (j === null) continue;
      pairExact(parasA[i], parasB[j]);
      pairedA.add(i);
      pairedB.add(j);
    }
  }

  // 2) 整段移动：同文但不同位（不计改动）
  for (let i = 0; i < parasA.length; i++) {
    if (pairedA.has(i)) continue;
    for (let j = 0; j < parasB.length; j++) {
      if (pairedB.has(j) || parasA[i].key !== parasB[j].key) continue;
      pairExact(parasA[i], parasB[j]);
      pairedA.add(i);
      pairedB.add(j);
      infos.push({
        kind: 'moved',
        text: parasA[i].key,
        locA: locateA(tokensA[parasA[i].start]),
        locB: locateB(tokensB[parasB[j].start]),
      });
      break;
    }
  }

  // 3) 段落拆分/合并：一段 ↔ 连续几段且拼接后完全相等（不计改动）
  /** 「一」侧的段落与「多」侧的连续段落逐字 1:1 配对（键相等 → 字数相同） */
  const pairOneToMany = (one: Para, oneIsA: boolean, many: Para[]) => {
    let k = 0;
    for (const m of many) {
      for (let t = m.start; t < m.end; t++) {
        const oneIdx = one.start + k;
        if (oneIsA) {
          matchA[oneIdx] = t;
          matchB[t] = oneIdx;
        } else {
          matchB[oneIdx] = t;
          matchA[t] = oneIdx;
        }
        k++;
      }
    }
  };
  for (let i = 0; i < parasA.length; i++) {
    if (pairedA.has(i)) continue;
    const keyA = parasA[i].key;
    let found = false;
    for (let j0 = 0; j0 < parasB.length && !found; j0++) {
      if (pairedB.has(j0)) continue;
      let acc = '';
      const js: number[] = [];
      for (let j = j0; j < parasB.length && acc.length < keyA.length; j++) {
        if (pairedB.has(j)) break;
        acc += parasB[j].key;
        js.push(j);
        if (acc === keyA && js.length >= 2) {
          pairOneToMany(parasA[i], true, js.map((j) => parasB[j]));
          pairedA.add(i);
          js.forEach((x) => pairedB.add(x));
          infos.push({
            kind: 'split',
            text: keyA,
            detail: String(js.length),
            locA: locateA(tokensA[parasA[i].start]),
            locB: locateB(tokensB[parasB[js[0]].start]),
          });
          found = true;
          break;
        }
        if (!keyA.startsWith(acc)) break;
      }
    }
  }
  for (let j = 0; j < parasB.length; j++) {
    if (pairedB.has(j)) continue;
    const keyB = parasB[j].key;
    let found = false;
    for (let i0 = 0; i0 < parasA.length && !found; i0++) {
      if (pairedA.has(i0)) continue;
      let acc = '';
      const is: number[] = [];
      for (let i = i0; i < parasA.length && acc.length < keyB.length; i++) {
        if (pairedA.has(i)) break;
        acc += parasA[i].key;
        is.push(i);
        if (acc === keyB && is.length >= 2) {
          pairOneToMany(parasB[j], false, is.map((i) => parasA[i]));
          pairedB.add(j);
          is.forEach((x) => pairedA.add(x));
          infos.push({
            kind: 'merged',
            text: keyB,
            detail: String(is.length),
            locA: locateA(tokensA[parasA[is[0]].start]),
            locB: locateB(tokensB[parasB[j].start]),
          });
          found = true;
          break;
        }
        if (!keyB.startsWith(acc)) break;
      }
    }
  }

  // 4) 模糊配对：内容相近的段落（含 1:1 与 1:N/N:1），相似度不足的标「疑似错位」
  {
    interface Cand {
      score: number;
      confident: boolean;
      ais: number[];
      bjs: number[];
    }
    const cands: Cand[] = [];
    const paraTextsA = parasA.map((p) => tokensA.slice(p.start, p.end).map((t) => t.text));
    const paraTextsB = parasB.map((p) => tokensB.slice(p.start, p.end).map((t) => t.text));
    for (let i = 0; i < parasA.length; i++) {
      if (pairedA.has(i)) continue;
      const ta = paraTextsA[i];
      for (let j = 0; j < parasB.length; j++) {
        if (pairedB.has(j)) continue;
        const sim = (2 * lcsLength(ta, paraTextsB[j])) / (ta.length + paraTextsB[j].length);
        if (sim >= FUZZY_MIN) {
          cands.push({ score: sim, confident: sim >= FUZZY_CONFIDENT, ais: [i], bjs: [j] });
        }
      }
      // 1:N（A 的一段 ↔ B 的连续几段）：看 A 的覆盖率
      for (let j0 = 0; j0 < parasB.length; j0++) {
        if (pairedB.has(j0)) continue;
        const js: number[] = [];
        let tb: string[] = [];
        for (let j = j0; j < parasB.length && js.length < MAX_PARTS; j++) {
          if (pairedB.has(j)) break;
          js.push(j);
          tb = tb.concat(paraTextsB[j]);
          if (js.length < 2) continue;
          const cov = lcsLength(ta, tb) / ta.length;
          if (cov >= CONCAT_MIN) {
            cands.push({ score: cov, confident: cov >= CONCAT_CONFIDENT, ais: [i], bjs: [...js] });
          }
        }
      }
    }
    // N:1（A 的连续几段 ↔ B 的一段）：看 B 的覆盖率
    for (let j = 0; j < parasB.length; j++) {
      if (pairedB.has(j)) continue;
      const tb = paraTextsB[j];
      for (let i0 = 0; i0 < parasA.length; i0++) {
        if (pairedA.has(i0)) continue;
        const is: number[] = [];
        let ta: string[] = [];
        for (let i = i0; i < parasA.length && is.length < MAX_PARTS; i++) {
          if (pairedA.has(i)) break;
          is.push(i);
          ta = ta.concat(paraTextsA[i]);
          if (is.length < 2) continue;
          const cov = lcsLength(tb, ta) / tb.length;
          if (cov >= CONCAT_MIN) {
            cands.push({ score: cov, confident: cov >= CONCAT_CONFIDENT, ais: [...is], bjs: [j] });
          }
        }
      }
    }
    cands.sort((x, y) => y.score - x.score);
    const uncertain: string[] = [];
    for (const c of cands) {
      if (c.ais.some((i) => pairedA.has(i)) || c.bjs.some((j) => pairedB.has(j))) continue;
      const aS = parasA[c.ais[0]].start;
      const aE = parasA[c.ais[c.ais.length - 1]].end;
      const bS = parasB[c.bjs[0]].start;
      const bE = parasB[c.bjs[c.bjs.length - 1]].end;
      alignSub(tokensA, aS, aE, tokensB, bS, bE, (t) => t.text, matchA, matchB);
      c.ais.forEach((i) => pairedA.add(i));
      c.bjs.forEach((j) => pairedB.add(j));
      if (!c.confident) {
        uncertain.push(
          `「${truncate(joinText(tokensA, aS, aE))}」↔「${truncate(joinText(tokensB, bS, bE))}」`,
        );
      }
    }
    if (uncertain.length > 0) {
      warnings.push(
        `有 ${uncertain.length} 组段落只是勉强对上（内容相似但差异不小），可能是错位（移动后又有改写）也可能是真改，已按最相近的方式对齐，请人工核对：${uncertain.join('；')}`,
      );
    }
  }

  // 5) 字级移动配对（段落内部或跨段落的句子挪动，不计改动）
  pairMoves(tokensA, tokensB, matchA, matchB, infos, locateA, locateB);

  // 6) 改动条目
  const changes: ChangeItem[] = [];
  let id = 0;

  // 换读音：已对齐但点字签名不同
  for (let i = 0; i < tokensA.length; i++) {
    const j = matchA[i];
    if (j === null) continue;
    const ta = tokensA[i];
    const tb = tokensB[j];
    if (ta.sig === tb.sig) continue;
    changes.push({
      id: `c${id++}`,
      kind: 'modified',
      text: tb.text,
      char: ta.text,
      readingA: ta.reading,
      readingB: tb.reading,
      locA: locateA(ta),
      locB: locateB(tb),
      aStart: ta.rawStart,
      aEnd: ta.rawEnd,
      bStart: tb.rawStart,
      bEnd: tb.rawEnd,
    });
  }

  const unmatchedA = matchA.map((m) => m === null);
  const unmatchedB = matchB.map((m) => m === null);

  /** 块文本：段落在源版本中有换行的地方补 \n */
  const textWithParas = (tokens: DiffToken[], s: number, e: number) => {
    let out = '';
    for (let k = s; k < e; k++) {
      if (k > s && tokens[k].para !== tokens[k - 1].para) out += '\n';
      out += tokens[k].text;
    }
    return out;
  };

  /** 插入锚点：块之前最近一个已配对 token 的对端原文位置（无前则取后一个，再无则 0） */
  const anchorAfter = (match: (number | null)[], tokens: DiffToken[], before: number, scanFrom: number) => {
    for (let k = before; k >= 0; k--) {
      const m = match[k];
      if (m !== null) return tokens[m].rawEnd;
    }
    for (let k = scanFrom; k < match.length; k++) {
      const m = match[k];
      if (m !== null) return tokens[m].rawStart;
    }
    return 0;
  };

  // 删除块（版本A 有、版本B 没有）
  for (const r of runsOf(unmatchedA)) {
    changes.push({
      id: `c${id++}`,
      kind: 'deleted',
      text: joinText(tokensA, r.start, r.end),
      locA: locateA(tokensA[r.start]),
      aStart: tokensA[r.start].rawStart,
      aEnd: tokensA[r.end - 1].rawEnd,
      // 反向应用（搬到 B）时：把这段文字插回 B 的对应位置
      insertAfterB: anchorAfter(matchA, tokensB, r.start - 1, r.end),
      insertTextB: textWithParas(tokensA, r.start, r.end),
      paraBefore: r.start === 0 || tokensA[r.start - 1].para !== tokensA[r.start].para,
      paraAfter: r.end === tokensA.length || tokensA[r.end].para !== tokensA[r.end - 1].para,
    });
  }

  // 新增块（版本B 有、版本A 没有）
  for (const r of runsOf(unmatchedB)) {
    changes.push({
      id: `c${id++}`,
      kind: 'added',
      text: joinText(tokensB, r.start, r.end),
      locB: locateB(tokensB[r.start]),
      bStart: tokensB[r.start].rawStart,
      bEnd: tokensB[r.end - 1].rawEnd,
      insertAfterA: anchorAfter(matchB, tokensA, r.start - 1, r.end),
      insertTextA: textWithParas(tokensB, r.start, r.end),
      paraBefore: r.start === 0 || tokensB[r.start - 1].para !== tokensB[r.start].para,
      paraAfter: r.end === tokensB.length || tokensB[r.end].para !== tokensB[r.end - 1].para,
    });
  }

  // 7) 提示：对齐率 / 无法对齐 / 疑似错位（字级残留）
  const matchedCount = matchA.filter((m) => m !== null).length;
  const total = Math.max(tokensA.length, tokensB.length);
  const alignRatio = total === 0 ? 1 : matchedCount / total;
  if (total > 0 && matchedCount === 0) {
    warnings.push(
      '两份文档没有能对上的内容，根本对不上号：请确认是否选错了版本。下列结果按「全部删除＋全部新增」列出——这属于真改，不是错位。',
    );
  } else if (alignRatio < 0.3) {
    warnings.push(
      `两份文档只有约 ${Math.round(alignRatio * 100)}% 的内容互相对应，差异过大，比对结果可能不可靠，请确认是否选错版本。`,
    );
  }
  // 字级残留：剩下的删除块与新增块内容高度相似（≥50%）但没能对齐
  const simPairs: string[] = [];
  for (const d of runsOf(unmatchedA)) {
    if (d.end - d.start < 3) continue;
    const dText = joinText(tokensA, d.start, d.end);
    for (const s of runsOf(unmatchedB)) {
      if (s.end - s.start < 3) continue;
      const sText = joinText(tokensB, s.start, s.end);
      const countB = new Map<string, number>();
      for (const ch of sText) countB.set(ch, (countB.get(ch) ?? 0) + 1);
      let common = 0;
      for (const ch of dText) {
        const c = countB.get(ch) ?? 0;
        if (c > 0) {
          common++;
          countB.set(ch, c - 1);
        }
      }
      const sim = (2 * common) / (dText.length + sText.length);
      if (sim >= 0.5) {
        simPairs.push(`「${truncate(dText)}」↔「${truncate(sText)}」`);
        break;
      }
    }
  }
  if (simPairs.length > 0) {
    warnings.push(
      `有 ${simPairs.length} 组删除/新增内容高度相似但位置对不上，疑似错位（可能是移动后又有改写，也可能是真改），请人工核对：${simPairs.join('；')}`,
    );
  }

  return {
    changes,
    infos,
    warnings,
    stats: {
      added: changes.filter((c) => c.kind === 'added').length,
      deleted: changes.filter((c) => c.kind === 'deleted').length,
      modified: changes.filter((c) => c.kind === 'modified').length,
      alignRatio,
    },
  };
}

function truncate(s: string, n = 12) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/* ---------- 应用改动：把选中的改动搬到另一版（生成新文档内容） ---------- */

export interface ApplyResult {
  raw: string;
  overrides: Record<string, string>;
  confirmed: string[];
  /** 成功应用的条数 */
  applied: number;
  /** 无法自动应用的条目说明（如非汉字的点字变化） */
  skipped: string[];
}

const HANZI_RE = /^[一-龥]$/;

/**
 * direction='forward'：把「A→B」的改动应用到版本A（让 A 追上 B）；
 * direction='reverse'：应用到版本B（撤销这些改动，让 B 退回 A）。
 * 文本编辑按偏移从后往前应用；读音变化写回 overrides（与编辑器「所选方」行为一致）。
 */
export function applyChanges(source: Doc, items: ChangeItem[], direction: 'forward' | 'reverse'): ApplyResult {
  const forward = direction === 'forward';
  const ops: { offset: number; del: number; text: string }[] = [];
  const overrides: Record<string, string> = { ...(source.overrides ?? {}) };
  const confirmed = new Set(source.confirmed ?? []);
  let applied = 0;
  const skipped: string[] = [];

  const adjustInsert = (text: string, raw: string, offset: number, paraBefore: boolean, paraAfter: boolean) => {
    let t = text;
    const atLineStart = offset <= 0 || raw[offset - 1] === '\n';
    const atLineEnd = offset >= raw.length || raw[offset] === '\n';
    if (paraBefore && !atLineStart) t = `\n${t}`;
    if (paraAfter && !atLineEnd) t = `${t}\n`;
    return t;
  };

  for (const it of items) {
    if (it.kind === 'modified') {
      const reading = forward ? it.readingB : it.readingA;
      if (it.char && HANZI_RE.test(it.char)) {
        if (reading) {
          overrides[it.char] = reading;
          confirmed.add(it.char);
        } else {
          delete overrides[it.char];
        }
        applied++;
      } else {
        skipped.push(it.text);
      }
      continue;
    }
    if (it.kind === 'deleted') {
      if (forward) {
        ops.push({ offset: it.aStart ?? 0, del: (it.aEnd ?? 0) - (it.aStart ?? 0), text: '' });
      } else {
        const at = it.insertAfterB ?? 0;
        ops.push({
          offset: at,
          del: 0,
          text: adjustInsert(it.insertTextB ?? it.text, source.raw, at, it.paraBefore ?? false, it.paraAfter ?? false),
        });
      }
      applied++;
      continue;
    }
    // added
    if (forward) {
      const at = it.insertAfterA ?? 0;
      ops.push({
        offset: at,
        del: 0,
        text: adjustInsert(it.insertTextA ?? it.text, source.raw, at, it.paraBefore ?? false, it.paraAfter ?? false),
      });
    } else {
      ops.push({ offset: it.bStart ?? 0, del: (it.bEnd ?? 0) - (it.bStart ?? 0), text: '' });
    }
    applied++;
  }

  // 同一位置的删除与插入合并（先删后插），再按偏移从后往前应用
  const byOffset = new Map<number, { offset: number; del: number; text: string }>();
  for (const op of ops) {
    const cur = byOffset.get(op.offset);
    if (cur) {
      cur.del += op.del;
      cur.text += op.text;
    } else {
      byOffset.set(op.offset, { ...op });
    }
  }
  let raw = source.raw;
  for (const op of [...byOffset.values()].sort((x, y) => y.offset - x.offset)) {
    raw = raw.slice(0, op.offset) + op.text + raw.slice(op.offset + op.del);
  }
  return { raw, overrides, confirmed: [...confirmed], applied, skipped };
}
