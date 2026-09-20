/**
 * 轻量中文分词：正向最大匹配（词典驱动，词典为随包发布的 JSON）。
 * 词边界决定盲文换行合法性（词不跨行），也决定分词连写的空方。
 */
import segmentDict from '../rules/segment-dict.json';
import { splitPinyinRun } from './pinyin';

const dict: Record<string, 1> = segmentDict as Record<string, 1>;
const MAX_WORD_LEN = 6;

let cachedSet: Set<string> | null = null;
function wordSet(): Set<string> {
  if (!cachedSet) cachedSet = new Set(Object.keys(dict));
  return cachedSet;
}

/** 是否为收录词 */
export function isWord(w: string): boolean {
  return wordSet().has(w);
}

const HANZI_RE = /[\u4e00-\u9fa5]/;

/** 对一段汉字串做正向最大匹配，返回词数组 */
export function segmentHanzi(text: string): string[] {
  const words: string[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = '';
    const maxLen = Math.min(MAX_WORD_LEN, text.length - i);
    for (let len = maxLen; len >= 2; len--) {
      const cand = text.slice(i, i + len);
      if (wordSet().has(cand)) {
        matched = cand;
        break;
      }
    }
    if (matched) {
      words.push(matched);
      i += matched.length;
    } else {
      words.push(text[i]);
      i += 1;
    }
  }
  return words;
}

/** 判断字符类别 */
export function charType(ch: string): 'hanzi' | 'digit' | 'letter' | 'space' | 'other' {
  if (HANZI_RE.test(ch)) return 'hanzi';
  if (/[0-9]/.test(ch)) return 'digit';
  if (/[A-Za-z]/.test(ch)) return 'letter';
  if (/\s/.test(ch)) return 'space';
  return 'other';
}

/** 输入行 → 有序 token（词/数字串/字母串/标点等），汉字串已分词 */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const t = charType(ch);
    if (t === 'space') {
      i++;
      continue;
    }
    if (t === 'hanzi') {
      let j = i;
      while (j < line.length && charType(line[j]) === 'hanzi') j++;
      tokens.push(...segmentHanzi(line.slice(i, j)).map((w) => ({ text: w, type: 'hanzi' as const })));
      i = j;
      continue;
    }
    if (t === 'digit') {
      let j = i;
      while (j < line.length && /[0-9]/.test(line[j])) j++;
      // 小数：3.5
      if (line[j] === '.' && /[0-9]/.test(line[j + 1] ?? '')) {
        j++;
        while (j < line.length && /[0-9]/.test(line[j])) j++;
      }
      tokens.push({ text: line.slice(i, j), type: 'digit' });
      i = j;
      continue;
    }
    if (t === 'letter') {
      let j = i;
      while (j < line.length && charType(line[j]) === 'letter') j++;
      // 拼音声调数字并入：全小写合法拼音串 + 单个声调数字 0-4（如 zhi1、hao3、de0）
      const nextCh = line[j] ?? '';
      const run = line.slice(i, j);
      if (
        /^[0-4]$/.test(nextCh) &&
        !/[0-9]/.test(line[j + 1] ?? '') &&
        /^[a-z]+$/.test(run) &&
        splitPinyinRun(run)
      ) {
        j++;
      }
      tokens.push({ text: line.slice(i, j), type: 'letter' });
      i = j;
      continue;
    }
    // other：破折号/省略号等多字符号优先
    const two = line.slice(i, i + 2);
    if (two === '——' || two === '……') {
      tokens.push({ text: two, type: 'other' });
      i += 2;
      continue;
    }
    tokens.push({ text: ch, type: 'other' });
    i += 1;
  }
  return tokens;
}

export interface Token {
  text: string;
  type: 'hanzi' | 'digit' | 'letter' | 'other';
}
