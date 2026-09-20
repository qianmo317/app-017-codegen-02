/**
 * 拼音音节解析与盲文声韵拼合。
 * 规则依据 GB/T 15720-1995 §4（现行盲文方案）与 GF 0019-2018（国家通用盲文方案）。
 */
import initialsJson from '../rules/zh-initials.json';
import finalsJson from '../rules/zh-finals.json';
import { dotsToUnicode } from './dots';

export const INITIALS: Record<string, string> = initialsJson.initials;
export const FINALS: Record<string, string> = finalsJson.finals;
/** 可自成音节的声母（省略韵母 i） */
export const SELF_STANDING = new Set<string>(initialsJson.selfStandingInitials);

const TONE_DOTS: Record<number, number[]> = { 1: [1], 2: [2], 3: [3], 4: [2, 3] };

/** 国家通用盲文声调省写规则（GF 0019-2018 §10.2，确定性部分 10.2.1-10.2.7） */
export const TONE2_KEEP = ['p', 'm', 't', 'n', 'h', 'q', 'ch', 'r', 'c'];
export const TONE4_KEEP = ['b', 'd', 'l', 'g', 'k', 'j', 'x', 'zh', 'sh', 'z', 's'];
export const SEC105_OMIT: Record<string, number[]> = {
  // 10.2.5：这些音节的这些声调省写；其余声调（yi4/er4/wo4/ye4/you4）不省写
  yi: [1], er: [2], wo: [3], ye: [3], you: [3],
};

export interface ParsedSyllable {
  initial: string | null;
  final: string;
  tone: number; // 0=轻声
  /** 规范拼音（带调数字），如 zhong1 */
  canonical: string;
}

const TONE_MARKS: Record<string, number> = {
  ā: 1, á: 2, ǎ: 3, à: 4,
  ē: 1, é: 2, ě: 3, è: 4,
  ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4,
  ū: 1, ú: 2, ǔ: 3, ù: 4,
  ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};

/** 去掉声调符号，返回 (无调拼音, 声调)。声调取尾数字（0=轻声）或变音符号；无标记 → 0（轻声） */
export function stripTone(s: string): [string, number] {
  let tone = 0;
  let out = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '5') {
      tone = Number(ch);
    } else if (TONE_MARKS[ch] !== undefined) {
      tone = TONE_MARKS[ch];
      out += BASE_VOWEL[ch];
    } else {
      out += ch;
    }
  }
  return [out.toLowerCase(), tone];
}

const BASE_VOWEL: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'v', ǘ: 'v', ǚ: 'v', ǜ: 'v',
};

/** 解析单个拼音音节（可带调）。失败返回 null。 */
export function parseSyllable(input: string): ParsedSyllable | null {
  const [base, tone] = stripTone(input.trim());
  if (!base || !/^[a-zü]+$/.test(base)) return null;
  let s = base.replace(/ü/g, 'v');

  // y / w 开头 → 韵母自成音节
  if (s[0] === 'y' || s[0] === 'w') {
    const f = YW_FINALS[s];
    if (!f) return null;
    return { initial: null, final: f, tone, canonical: `${s}${tone || ''}` };
  }

  let initial: string | null = null;
  let rest = s;
  if (s.length >= 2) {
    const two = s.slice(0, 2);
    if (two === 'zh' || two === 'ch' || two === 'sh') {
      initial = two;
      rest = s.slice(2);
    }
  }
  if (!initial && 'bpmfdtnlgkhjqxrzcs'.includes(s[0])) {
    initial = s[0];
    rest = s.slice(1);
  }

  // 自成音节声母：zhi chi shi ri zi ci si（canonical 用规范拼写 zhi/zi…，声调省写例外按 zi/le 等匹配）
  if (initial && SELF_STANDING.has(initial) && (rest === 'i' || rest === '')) {
    return { initial, final: '', tone, canonical: `${initial}i${tone || ''}` };
  }
  if (!initial && rest === '') return null;

  let fin = rest;
  // j/q/x + u → ü 行；n/l/v 拼写
  if ((initial === 'j' || initial === 'q' || initial === 'x') && fin.startsWith('u') && !fin.startsWith('ue')) {
    fin = 'v' + fin.slice(1);
  }
  if (!initial) {
    // 韵母自成音节（已处理 y/w），如 a、ai、er
  }
  // 拼音缩写 → 规范韵母
  const YW_ROW = initial === null || initial === 'j' || initial === 'q' || initial === 'x';
  if (fin === 'iu') fin = 'iou';
  else if (fin === 'ui') fin = 'uei';
  else if (fin === 'un') fin = YW_ROW && initial !== null ? 'vn' : initial === null ? 'uen' : 'uen';
  else if (fin === 'uan') fin = YW_ROW && initial !== null ? 'van' : 'uan';
  else if (fin === 'ue') fin = 've';
  else if (fin === 'van' || fin === 'ven' || fin === 'vo') {
    // 用户直接写 ü 行的 ASCII 形式
  }
  if (initial === null && (fin === 'van' || fin === 'vn' || fin === 've' || fin === 'v')) {
    fin = { van: 'van', vn: 'vn', ve: 've', v: 'v' }[fin] as string;
  }

  if (!FINALS[fin]) return null;
  if (initial && !fin) return null;
  return { initial, final: fin, tone, canonical: `${initial ?? ''}${fin}${tone || ''}` };
}

const YW_FINALS: Record<string, string> = {
  ya: 'ia', yao: 'iao', ye: 'ie', you: 'iou', yan: 'ian',
  yin: 'in', yang: 'iang', ying: 'ing', yong: 'iong', yu: 'v', yue: 've',
  yuan: 'van', yun: 'vn', yi: 'i',
  wa: 'ua', wo: 'uo', wai: 'uai', wei: 'uei', wan: 'uan', wen: 'uen',
  wang: 'uang', weng: 'ueng', wu: 'u',
  a: 'a', o: 'o', e: 'e', er: 'er', ai: 'ai', ei: 'ei', ao: 'ao', ou: 'ou',
  an: 'an', en: 'en', ang: 'ang', eng: 'eng',
};

/** y/w 及纯韵母音节的规范韵母（含 io/iai 等极罕用，转换时校验 FINALS 存在） */
export function zeroInitialFinal(s: string): string | null {
  return YW_FINALS[s] ?? null;
}

/** 音节 → 盲文点位（不含省写判断）。返回每方点位数组；未知韵母返回 null。 */
export function syllableToDotArrays(initial: string | null, final: string, tone: number): number[][] | null {
  const cells: number[][] = [];
  if (initial) {
    const initDots = INITIALS[initial]?.split('').map(Number);
    if (!initDots) return null;
    if (!final) {
      // 自成音节声母，声调点加在声母方
      cells.push(addTone(initDots, tone));
    } else {
      const finDots = FINALS[final]?.split('').map(Number);
      if (!finDots) return null;
      cells.push([...initDots]);
      cells.push(addTone(finDots, tone));
    }
  } else if (final) {
    const finDots = FINALS[final]?.split('').map(Number);
    if (!finDots) return null;
    cells.push(addTone(finDots, tone));
  }
  return cells;
}

export function addTone(dots: number[], tone: number): number[] {
  const extra = TONE_DOTS[tone];
  if (!extra) return [...dots];
  const set = new Set(dots);
  for (const d of extra) set.add(d);
  return [...set].sort((a, b) => a - b);
}

/** 音节的 Unicode 盲文串（调试/展示用） */
export function syllableToUnicode(initial: string | null, final: string, tone: number): string {
  const cells = syllableToDotArrays(initial, final, tone);
  return cells ? cells.map(dotsToUnicode).join('') : '';
}

/* ---------------- 用于"字母串按拼音识别"的有效音节表 ---------------- */

const F = (s: string) => s.split(' ');

// 各声母可搭配的韵母（标准普通话音节结构，用于分词级识别，不用于转换）
const COMBO: Record<string, string[]> = {
  b: F('a o ai ei ao an en ang eng ong i ie iao ian in iang ing u'),
  p: F('a o ai ei ao an en ang eng ong i ie iao ian in iang ing u'),
  m: F('a o e ai ei ao ou an en ang eng i ie iao ian in iang ing u'),
  f: F('a o ei ou an en ang eng u'),
  d: F('a e ai ei ao ou an en ang eng ong i ie iao iou ian ing u uo uei uan uen'),
  t: F('a e ai ei ao ou an en ang eng ong i ie iao iou ian ing u uo uei uan uen'),
  n: F('a e ai ei ao ou an en ang eng ong i ie iao iou ian in iang ing u uo uan uen ve'),
  l: F('a e ai ei ao ou an en ang eng ong i ie iao iou ian in iang ing u uo uan uen ve'),
  g: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  k: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  h: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  j: F('i ia iao ie iou ian in iang ing iong v ve van vn'),
  q: F('i ia iao ie iou ian in iang ing iong v ve van vn'),
  x: F('i ia iao ie iou ian in iang ing iong v ve van vn'),
  zh: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  ch: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  sh: F('a e ai ei ao ou an en ang eng ong u ua uo uai uei uan uen uang'),
  r: F('e ao ou an en ang eng ong u ua uo uei uan uen'),
  z: F('a e ai ei ao ou an en ang eng ong u ua uo uei uan uen'),
  c: F('a e ai ei ao ou an en ang eng ong u ua uo uei uan uen'),
  s: F('a e ai ei ao ou an en ang eng ong u ua uo uei uan uen'),
};

const ZERO_SYLLABLES = new Set([
  'a', 'o', 'e', 'er', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng',
  ...Object.keys(YW_FINALS),
  // 自成音节声母
  'zhi', 'chi', 'shi', 'ri', 'zi', 'ci', 'si',
]);

/** 是否为有效拼音音节（无调） */
export function isValidSyllable(base: string): boolean {
  const s = base.replace(/ü/g, 'v').toLowerCase();
  if (ZERO_SYLLABLES.has(s)) return true;
  let initial: string | null = null;
  let rest = s;
  if (s.length >= 2 && ['zh', 'ch', 'sh'].includes(s.slice(0, 2))) {
    initial = s.slice(0, 2);
    rest = s.slice(2);
  } else if ('bpmfdtnlgkhjqxrzcs'.includes(s[0])) {
    initial = s[0];
    rest = s.slice(1);
  } else {
    return false;
  }
  if (!initial) return false;
  let fin = rest;
  if (['j', 'q', 'x'].includes(initial)) {
    if (fin.startsWith('u') && !fin.startsWith('ue')) fin = 'v' + fin.slice(1);
    if (fin === 'un') fin = 'vn';
    if (fin === 'uan') fin = 'van';
    if (fin === 'ue') fin = 've';
  }
  if (fin === 'iu') fin = 'iou';
  if (fin === 'ui') fin = 'uei';
  if (fin === 'ue') fin = 've';
  return COMBO[initial].includes(fin);
}

/** 把无调字母串切分为有效拼音音节（最长优先回溯，全部音节合法才算成功）。失败返回 null。
 *  音节可带声调数字后缀（0-4，0=轻声），如 zhi1、hao3、de0、ni1hao3。 */
export function splitPinyinRun(run: string): string[] | null {
  const s = run.replace(/ü/g, 'v').toLowerCase();
  const n = s.length;
  if (n === 0 || n > 64) return null;
  const res: string[] = [];
  function partValid(part: string): boolean {
    if (/[0-4]$/.test(part)) return isValidSyllable(part.slice(0, -1));
    return isValidSyllable(part);
  }
  function dfsLong(i: number, acc: string[]): boolean {
    if (i === n) {
      res.length = 0;
      res.push(...acc);
      return true;
    }
    for (let len = Math.min(7, n - i); len >= 1; len--) {
      const part = s.slice(i, i + len);
      if (partValid(part) && dfsLong(i + len, [...acc, part])) return true;
    }
    return false;
  }
  return dfsLong(0, []) ? res : null;
}
