/**
 * 反向转换：盲文方序列 → 汉字候选（用于校对）。
 * 同一点位可能对应多个声母/韵母/标点（如 g/j、o/e、分号/小写号），
 * 所有候选全部列出并标记 uncertain，绝不静默猜测。
 */
import punctJson from '../rules/zh-punct.json';
import digitsJson from '../rules/zh-digits.json';
import lettersJson from '../rules/zh-letters.json';
import hanziReadings from '../rules/zh-pinyin.json';
import type { BrailleCell } from '../types';
import { FINALS, INITIALS, SELF_STANDING, addTone, parseSyllable, zeroInitialFinal } from './pinyin';

const PUNCT = punctJson.punctuation as Record<string, string[]>;
const DIGITS = digitsJson.digits as Record<string, string>;
const LETTERS = lettersJson.letters as Record<string, string>;
const READINGS = hanziReadings as Record<string, string[]>;

const dotsKey = (dots: number[]) => [...dots].sort((a, b) => a - b).join('');
const parseDots = (s: string) => s.split('').map(Number);

function pushMap<T>(map: Map<string, T[]>, key: string, value: T) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/* ---------- 反查表（模块级构建一次） ---------- */

const INITIAL_BY_KEY = new Map<string, string[]>();
for (const [ini, ds] of Object.entries(INITIALS)) pushMap(INITIAL_BY_KEY, dotsKey(parseDots(ds)), ini);

const FINAL_BY_KEY = new Map<string, [string, number][]>(); // [韵母, 声调]
for (const [fin, ds] of Object.entries(FINALS)) {
  const base = parseDots(ds);
  for (const tone of [0, 1, 2, 3, 4]) {
    pushMap(FINAL_BY_KEY, dotsKey(addTone(base, tone)), [fin, tone]);
  }
}

const DIGIT_BY_KEY = new Map<string, string>();
for (const [digit, ds] of Object.entries(DIGITS)) DIGIT_BY_KEY.set(dotsKey(parseDots(ds)), digit);
// 小数点（数字上下文中 46 号）
DIGIT_BY_KEY.set(dotsKey([4, 6]), '.');

const LETTER_BY_KEY = new Map<string, string>();
for (const [letter, ds] of Object.entries(LETTERS)) LETTER_BY_KEY.set(dotsKey(parseDots(ds)), letter);

/** 标点：半角归一为全角，减少无意义歧义；按符号长度建序列索引 */
const HALF_TO_FULL: Record<string, string> = {
  '.': '。', ',': '，', ';': '；', ':': '：', '?': '？', '!': '！',
  '(': '（', ')': '）', '[': '［', ']': '］', '-': '－', '*': '＊',
};
const normPunct = (s: string) => HALF_TO_FULL[s] ?? s;

const PUNCT_BY_SEQ = new Map<string, string[]>(); // key = 各方 dotsKey 用 '|' 连接
for (const [src, cellDots] of Object.entries(PUNCT)) {
  const key = cellDots.map((d) => dotsKey(parseDots(d))).join('|');
  const val = normPunct(src);
  const arr = PUNCT_BY_SEQ.get(key);
  if (arr && !arr.includes(val)) arr.push(val);
  else if (!arr) PUNCT_BY_SEQ.set(key, [val]);
}

/** 韵母 → 韵母自成音节的 y/w 拼写（与词典 canonical 保持一致） */
const SPELLING_BY_FINAL: Record<string, string> = {
  ia: 'ya', iao: 'yao', ie: 'ye', iou: 'you', ian: 'yan', in: 'yin',
  iang: 'yang', ing: 'ying', iong: 'yong', v: 'yu', ve: 'yue',
  van: 'yuan', vn: 'yun', i: 'yi',
  ua: 'wa', uo: 'wo', uai: 'wai', uei: 'wei', uan: 'wan', uen: 'wen',
  uang: 'wang', ueng: 'weng', u: 'wu',
  a: 'a', o: 'o', e: 'e', er: 'er', ai: 'ai', ei: 'ei', ao: 'ao',
  ou: 'ou', an: 'an', en: 'en', ang: 'ang', eng: 'eng',
};
const FINAL_TO_SPELLING = new Map<string, string>(Object.entries(SPELLING_BY_FINAL));

/* ---------- 汉字读音倒排索引（懒构建） ---------- */

let INDEX_WITH_TONE: Map<string, string[]> | null = null;
let INDEX_BARE: Map<string, string[]> | null = null;

function buildIndex() {
  if (INDEX_WITH_TONE && INDEX_BARE) return;
  INDEX_WITH_TONE = new Map();
  INDEX_BARE = new Map();
  for (const [ch, readings] of Object.entries(READINGS)) {
    for (const r of readings) {
      const p = parseSyllable(r);
      if (!p) continue;
      pushMap(INDEX_WITH_TONE, p.canonical, ch);
      pushMap(INDEX_BARE, p.canonical.replace(/\d+$/, ''), ch);
    }
  }
}

const TONE_EXTRA: Record<string, number> = {
  '': 0,
  [dotsKey([1])]: 1,
  [dotsKey([2])]: 2,
  [dotsKey([3])]: 3,
  [dotsKey([2, 3])]: 4,
};

/** 从一方中提取声调点（rest = 方内除声母/韵母点之外的点） */
function toneFromExtra(extra: number[]): number {
  return TONE_EXTRA[dotsKey(extra)] ?? -1;
}

/* ---------- 反向解析 ---------- */

export interface ReverseToken {
  kind: 'hanzi' | 'number' | 'letter' | 'punct' | 'space' | 'unknown';
  text: string;
  candidates: string[];
  certain: boolean;
  /** 消耗的方数 */
  len: number;
}

export interface ReverseResult {
  tokens: ReverseToken[];
  text: string;
  uncertainCount: number;
}

const UNKNOWN_TOKEN: ReverseToken = { kind: 'unknown', text: '□', candidates: [], certain: false, len: 1 };
const SPACE_TOKEN: ReverseToken = { kind: 'space', text: ' ', candidates: [], certain: true, len: 1 };

/** 尝试在 i 处解析标点（最长 3 方匹配） */
function matchPunct(cells: BrailleCell[], i: number): ReverseToken | null {
  for (const span of [3, 2, 1]) {
    const keys: string[] = [];
    let ok = true;
    for (let k = 0; k < span; k++) {
      const c = cells[i + k];
      if (!c || c.dots.length === 0) {
        ok = false;
        break;
      }
      keys.push(dotsKey(c.dots));
    }
    if (!ok) continue;
    const candidates = PUNCT_BY_SEQ.get(keys.join('|'));
    if (candidates && candidates.length > 0) {
      return {
        kind: 'punct',
        text: candidates.length === 1 ? candidates[0] : `[${candidates.join('/')}]`,
        candidates,
        certain: candidates.length === 1,
        len: span,
      };
    }
  }
  return null;
}

/** 尝试在 i 处解析汉语音节（声韵调），返回所有读法候选 */
function parseSyllableAt(cells: BrailleCell[], i: number): ReverseToken | null {
  const c = cells[i];
  if (!c || c.dots.length === 0) return null;
  const k0 = dotsKey(c.dots);
  const iniCandidates = INITIAL_BY_KEY.get(k0) ?? [];

  const tryCompose = (initials: string[], finals: [string, number][], len: number): ReverseToken | null => {
    if (initials.length === 0 || finals.length === 0) return null;
    buildIndex();
    const candidates = new Set<string>();
    let anyExact = false;
    for (const ini of initials) {
      for (const [fin, tone] of finals) {
        const canonical = `${ini}${fin}${tone || ''}`;
        const found = tone > 0 ? INDEX_WITH_TONE!.get(canonical) : INDEX_BARE!.get(canonical);
        if (found) {
          found.forEach((ch) => candidates.add(ch));
          anyExact = true;
        }
      }
    }
    if (!anyExact) return null;
    const list = [...candidates];
    return {
      kind: 'hanzi',
      text: list.length === 1 ? list[0] : `[${list.slice(0, 12).join('/')}${list.length > 12 ? '…' : ''}]`,
      candidates: list,
      certain: list.length === 1,
      len,
    };
  };

  // 1) 声母 + 韵母（两方）
  if (iniCandidates.length > 0 && i + 1 < cells.length && cells[i + 1].dots.length > 0) {
    const finCandidates = FINAL_BY_KEY.get(dotsKey(cells[i + 1].dots)) ?? [];
    const composed = tryCompose(iniCandidates, finCandidates, 2);
    if (composed) return composed;
  }

  // 2) 声母自成音节（单方，调点在声母方）：zhi chi shi ri zi ci si
  if (iniCandidates.length > 0) {
    const initialDots = new Set<string>();
    for (const ini of iniCandidates) {
      const ids = dotsKey(parseDots(INITIALS[ini]));
      initialDots.add(ids);
    }
    // 该方必须恰好是 声母点 + 纯调点
    const rest = c.dots.filter((d) => {
      return !iniCandidates.some((ini) => parseDots(INITIALS[ini]).includes(d));
    });
    const tone = toneFromExtra(rest);
    if (tone >= 0) {
      const selfStanding = iniCandidates.filter((ini) => SELF_STANDING.has(ini));
      if (selfStanding.length > 0) {
        buildIndex();
        const candidates = new Set<string>();
        for (const ini of selfStanding) {
          const canonical = `${ini}i${tone || ''}`;
          const found = tone > 0 ? INDEX_WITH_TONE!.get(canonical) : INDEX_BARE!.get(canonical);
          if (found) found.forEach((ch) => candidates.add(ch));
        }
        if (candidates.size > 0) {
          const list = [...candidates];
          return {
            kind: 'hanzi',
            text: list.length === 1 ? list[0] : `[${list.slice(0, 12).join('/')}${list.length > 12 ? '…' : ''}]`,
            candidates: list,
            certain: list.length === 1,
            len: 1,
          };
        }
      }
    }
  }

  // 3) 韵母自成音节（单方）
  const finCandidates = FINAL_BY_KEY.get(k0) ?? [];
  if (finCandidates.length > 0) {
    buildIndex();
    const candidates = new Set<string>();
    for (const [fin, tone] of finCandidates) {
      const spelling = FINAL_TO_SPELLING.get(fin) ?? zeroInitialFinal(fin) ?? fin;
      const canonical = `${spelling}${tone || ''}`;
      const found = tone > 0 ? INDEX_WITH_TONE!.get(canonical) : INDEX_BARE!.get(canonical);
      if (found) found.forEach((ch) => candidates.add(ch));
    }
    if (candidates.size > 0) {
      const list = [...candidates];
      return {
        kind: 'hanzi',
        text: list.length === 1 ? list[0] : `[${list.slice(0, 12).join('/')}${list.length > 12 ? '…' : ''}]`,
        candidates: list,
        certain: list.length === 1,
        len: 1,
      };
    }
  }

  return null;
}

/** 盲文方序列 → 带不确定标注的文本（校对用） */
export function reverseConvert(cells: BrailleCell[]): ReverseResult {
  const tokens: ReverseToken[] = [];
  let i = 0;
  while (i < cells.length) {
    const c = cells[i];
    if (!c || c.dots.length === 0) {
      tokens.push(SPACE_TOKEN);
      i++;
      continue;
    }
    const k = dotsKey(c.dots);
    const next = cells[i + 1];

    // 数字：数符(3456) + 数字方（可连续多位）
    if (k === '3456' && next && next.dots.length > 0 && DIGIT_BY_KEY.has(dotsKey(next.dots))) {
      let digits = '';
      let j = i + 1;
      while (j < cells.length && cells[j].dots.length > 0) {
        const d = DIGIT_BY_KEY.get(dotsKey(cells[j].dots));
        if (!d) break;
        digits += d;
        j++;
      }
      tokens.push({ kind: 'number', text: digits, candidates: [digits], certain: true, len: j - i });
      i = j;
      continue;
    }

    // 字母：小写号(56)/大写号(6) + 字母方（每方单独加号）
    if ((k === '56' || k === '6') && next && next.dots.length > 0) {
      const letter = LETTER_BY_KEY.get(dotsKey(next.dots));
      if (letter) {
        tokens.push({
          kind: 'letter',
          text: k === '56' ? letter : letter.toUpperCase(),
          candidates: [letter],
          certain: true,
          len: 2,
        });
        i += 2;
        continue;
      }
    }

    // 无号字母（GB 英文档小写）：直接是字母点位 → 按字母处理仅在音节解析失败后回退
    const punct = matchPunct(cells, i);
    const syllable = parseSyllableAt(cells, i);

    // 优先级：音节优先于 1 方标点（例如 '245' 是 ri 而不是孤立符号时）
    if (syllable) {
      tokens.push(syllable);
      i += syllable.len;
      continue;
    }
    if (punct) {
      tokens.push(punct);
      i += punct.len;
      continue;
    }

    // 裸字母（无字母号，GB 英文小写）
    const bareLetter = LETTER_BY_KEY.get(k);
    if (bareLetter) {
      tokens.push({ kind: 'letter', text: bareLetter, candidates: [bareLetter], certain: false, len: 1 });
      i++;
      continue;
    }

    tokens.push({ ...UNKNOWN_TOKEN });
    i++;
  }

  const text = tokens.map((t) => t.text).join('');
  const uncertainCount = tokens.filter((t) => !t.certain && t.kind !== 'space').length;
  return { tokens, text, uncertainCount };
}
