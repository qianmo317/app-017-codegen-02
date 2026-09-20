/**
 * 盲文转换引擎：原文（汉字/拼音/数字/英文/标点混合）→ 盲文方序列。
 * 规则表全部来自 src/rules/*.json；多音字标记 uncertain 并给候选，绝不静默猜测。
 */
import punctJson from '../rules/zh-punct.json';
import digitsJson from '../rules/zh-digits.json';
import lettersJson from '../rules/zh-letters.json';
import hanziReadings from '../rules/zh-pinyin.json';
import type { AppSettings, BrailleCell, DictEntry, RuleProfile, UncertainItem } from '../types';
import { tokenizeLine, type Token } from './segment';
import {
  parseSyllable,
  splitPinyinRun,
  syllableToDotArrays,
  SELF_STANDING,
  TONE2_KEEP,
  TONE4_KEEP,
  SEC105_OMIT,
  type ParsedSyllable,
} from './pinyin';

const PUNCT = punctJson.punctuation as Record<string, string[]>;
const DIGITS = digitsJson.digits as Record<string, string>;
const NUMBER_SIGN = digitsJson.numberSign;
const DECIMAL_SIGN = digitsJson.decimalSign ?? '46';
const LETTERS = lettersJson.letters as Record<string, string>;
const LOWER_SIGN = lettersJson.lowerSign;
const UPPER_SIGN = lettersJson.upperSign;
const READINGS = hanziReadings as Record<string, string[]>;

export interface WordCells {
  /** 来源词（可能多字） */
  source: string;
  cells: BrailleCell[];
  /** 原子词（数字串/字母串），排版时不可拆分 */
  atomic: boolean;
}

export interface ParagraphResult {
  words: WordCells[];
  blank: boolean;
}

export interface ConvertResult {
  paragraphs: ParagraphResult[];
  /** 扁平方序列（用于持久化与统计；分页布局由 paragraphs 重新推导） */
  cells: BrailleCell[];
  uncertain: UncertainItem[];
  stats: { cellCount: number; hanziCount: number };
}

export interface ConvertOptions {
  toneMode: AppSettings['toneMode'];
  autoDetectPinyin: boolean;
  profile: RuleProfile;
  /** 文档级读音覆盖：word 或 char → 拼音音节串（空格分隔） */
  overrides?: Record<string, string>;
  /** 已确认字符（含按默认读音确认） */
  confirmed?: string[];
  /** 全局词语表 */
  dictEntries?: DictEntry[];
}

function punctCells(source: string): BrailleCell[] | null {
  const dots = PUNCT[source];
  if (!dots) return null;
  return dots.map((d) => ({
    dots: d.split('').map(Number),
    source,
    kind: 'punct' as const,
  }));
}

/**
 * 国家通用盲文声调省写判断（GF 0019-2018 §10.2 确定性规则 10.2.1-10.2.7）。
 * 返回 true 表示省写该音节的声调点。
 */
export function shouldOmitTone(
  canonical: string,
  initial: string | null,
  tone: number,
  nextIsFinalOnly: boolean,
): boolean {
  const bare = canonical.replace(/\d$/, '');
  // 10.2.5：yī ér wǒ yě yǒu 省写（yì èr wò yè yòu 不省写）
  if (SEC105_OMIT[bare]?.includes(tone)) return true;
  if (!initial) {
    if (bare === 'o') return true; // 10.2.6：ō ó ǒ ò 省写（ē é ě 及 è 不省写）
    // 10.2.4：韵母自成音节省写去声，10.2.5/10.2.6 例外不省写
    if (tone === 4 && !['e', 'yi', 'er', 'wo', 'ye', 'you'].includes(bare)) return true;
    return false;
  }
  if (initial === 'f' && tone === 1) return true; // 10.2.1
  // 10.2.7：声母自成音节后连写零声母韵母时，不适用 10.2.2/10.2.3 → 恢复标调
  if (SELF_STANDING.has(initial) && (tone === 2 || tone === 4) && nextIsFinalOnly) {
    return false;
  }
  if (TONE2_KEEP.includes(initial) && tone === 2 && bare !== 'tou') return true; // 10.2.2
  if (TONE4_KEEP.includes(initial) && tone === 4 && !['le', 'zi'].includes(bare)) return true; // 10.2.3
  return false;
}

interface ResolvedReading {
  syllable: ParsedSyllable | null;
  candidates: string[];
  reading: string;
}

/** 单个汉字 → 音节信息 + 候选读音（优先词覆盖，其次字覆盖，最后词典默认） */
function resolveHanzi(ch: string, word: string, opts: ConvertOptions): ResolvedReading {
  const chars = [...word];
  const overrideWord = opts.overrides?.[word];
  if (overrideWord) {
    const parts = overrideWord.trim().split(/\s+/);
    const target = parts[chars.indexOf(ch)];
    if (target) {
      const parsed = parseSyllable(target);
      if (parsed) return { syllable: parsed, candidates: [parsed.canonical], reading: parsed.canonical };
    }
  }
  const overrideChar = opts.overrides?.[ch];
  if (overrideChar) {
    const parsed = parseSyllable(overrideChar.trim().split(/\s+/)[0]);
    if (parsed) return { syllable: parsed, candidates: [parsed.canonical], reading: parsed.canonical };
  }
  const readings = READINGS[ch];
  if (!readings || readings.length === 0) {
    return { syllable: null, candidates: [], reading: '' };
  }
  const parsed = parseSyllable(readings[0]);
  return {
    syllable: parsed,
    candidates: readings,
    reading: parsed ? parsed.canonical : readings[0],
  };
}

/** 转换一个词 → 方序列 */
function convertWord(
  word: string,
  type: Token['type'],
  opts: ConvertOptions,
  uncertainOut: UncertainItem[],
): WordCells {
  const cells: BrailleCell[] = [];
  const confirmed = opts.confirmed ?? [];

  if (type === 'hanzi') {
    const chars = [...word];
    const resolved = chars.map((ch) => ({ ch, r: resolveHanzi(ch, word, opts) }));
    for (let i = 0; i < resolved.length; i++) {
      const { ch, r } = resolved[i];
      if (!r.syllable) {
        // 未收录字：空方 + uncertain，等待用户给出拼音
        cells.push({ dots: [], source: ch, kind: 'hanzi', uncertain: true, reading: '' });
        uncertainOut.push({ char: ch, reading: '', candidates: [], unrecognized: true, word });
        continue;
      }
      const next = resolved[i + 1]?.r.syllable ?? null;
      const nextIsFinalOnly = !!next && next.initial === null && next.final !== '';
      let tone = r.syllable.tone;
      if (opts.toneMode === 'none') tone = 0;
      else if (
        opts.toneMode === 'national' &&
        shouldOmitTone(r.syllable.canonical, r.syllable.initial, r.syllable.tone, nextIsFinalOnly)
      ) {
        tone = 0;
      }
      const dotArrs = syllableToDotArrays(r.syllable.initial, r.syllable.final, tone);
      if (dotArrs) {
        dotArrs.forEach((d, di) =>
          cells.push({
            dots: d,
            source: ch,
            kind: 'hanzi',
            reading: di === dotArrs.length - 1 ? r.reading : '',
          }),
        );
      } else {
        cells.push({ dots: [], source: ch, kind: 'hanzi', uncertain: true, reading: r.reading });
      }
      // 多音字且未被确认 → uncertain（绝不静默猜测）
      if (r.candidates.length > 1 && !confirmed.includes(ch)) {
        uncertainOut.push({ char: ch, reading: r.reading, candidates: r.candidates, unrecognized: false, word });
      }
    }
    return { source: word, cells, atomic: false };
  }

  if (type === 'digit') {
    for (const ch of word) {
      if (ch === '.') {
        cells.push({ dots: DECIMAL_SIGN.split('').map(Number), kind: 'punct', source: ch });
        continue;
      }
      const d = DIGITS[ch];
      if (!d) continue;
      cells.push({ dots: NUMBER_SIGN.split('').map(Number), kind: 'prefix', source: ch });
      cells.push({ dots: d.split('').map(Number), kind: 'digit', source: ch });
    }
    return { source: word, cells, atomic: true };
  }

  if (type === 'letter') {
    // 自动识别：全小写（可带单个声调数字 0-4）且可完整切分为拼音音节 → 按拼音转（如 nihao、zhi1）
    if (opts.autoDetectPinyin && /^[a-z0-4]+$/.test(word)) {
      const parts = splitPinyinRun(word);
      if (parts) {
        for (const part of parts) {
          const syll = parseSyllable(part);
          if (!syll) continue;
          let tone = syll.tone;
          if (opts.toneMode === 'none') tone = 0;
          else if (opts.toneMode === 'national' && shouldOmitTone(syll.canonical, syll.initial, syll.tone, false)) tone = 0;
          const dots = syllableToDotArrays(syll.initial, syll.final, tone);
          if (dots) {
            for (const d of dots) cells.push({ dots: d, source: part, kind: 'hanzi' });
          }
        }
        return { source: word, cells, atomic: true };
      }
    }
    // 英文字母：每方加字母号（GF 0019-2018 §8；UEB 档位仅大写号）
    const useLetterSign = opts.profile === 'zh-current';
    for (const ch of word) {
      const lower = ch.toLowerCase();
      const dots = LETTERS[lower];
      if (!dots) continue;
      const isUpper = ch !== lower;
      if (useLetterSign || isUpper) {
        cells.push({
          dots: (isUpper ? UPPER_SIGN : LOWER_SIGN).split('').map(Number),
          kind: 'prefix',
          source: ch,
        });
      }
      cells.push({ dots: dots.split('').map(Number), kind: 'letter', source: ch });
    }
    return { source: word, cells, atomic: true };
  }

  // other：标点或未识别
  const pc = punctCells(word);
  if (pc) return { source: word, cells: pc, atomic: true };
  cells.push({ dots: [], source: word, kind: 'punct', uncertain: true });
  uncertainOut.push({ char: word, reading: '', candidates: [], unrecognized: true, word });
  return { source: word, cells, atomic: true };
}

/** 转换整篇原文 */
export function convertText(raw: string, opts: ConvertOptions): ConvertResult {
  // 词语表读音覆盖 → 合并进覆盖表
  const allOverrides: Record<string, string> = { ...(opts.overrides ?? {}) };
  for (const e of opts.dictEntries ?? []) {
    if (e.readingOverride) allOverrides[e.word] = e.readingOverride;
  }
  const effective: ConvertOptions = { ...opts, overrides: allOverrides };

  const uncertain: UncertainItem[] = [];
  const paragraphs: ParagraphResult[] = [];
  const flat: BrailleCell[] = [];

  let wordId = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') {
      paragraphs.push({ words: [], blank: true });
      continue;
    }
    const tokens = tokenizeLine(line);
    const words: WordCells[] = [];
    for (const tk of tokens) {
      const wc = convertWord(tk.text, tk.type, effective, uncertain);
      for (const c of wc.cells) c.wordId = wordId;
      wordId++;
      words.push(wc);
    }
    paragraphs.push({ words, blank: false });
  }
  // 同一字符只提示一次（首个出现位置）
  const deduped: UncertainItem[] = [];
  const seenChar = new Set<string>();
  for (const u of uncertain) {
    if (!seenChar.has(u.char)) {
      seenChar.add(u.char);
      deduped.push(u);
    }
  }
  for (const p of paragraphs) {
    for (const w of p.words) flat.push(...w.cells);
  }
  return {
    paragraphs,
    cells: flat,
    uncertain: deduped,
    stats: {
      cellCount: flat.length,
      hanziCount: flat.filter((c) => c.kind === 'hanzi').length,
    },
  };
}
