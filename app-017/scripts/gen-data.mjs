/**
 * 构建期数据生成脚本（一次性运行，产物随包发布，运行时零第三方依赖）：
 *  1. src/rules/zh-pinyin.json    —— 常用汉字 → 全部读音（多音字按常用度排序，首个为默认读音）
 *  2. src/rules/segment-dict.json —— 中文分词词典（词 → 频度），供最大匹配分词使用
 */
import { pinyin } from 'pinyin-pro';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 1. 汉字读音表 ----------
const readings = {}; // char -> [pinyin with tone, ...]
let count = 0;
for (let cp = 0x4e00; cp <= 0x9fa5; cp++) {
  const ch = String.fromCodePoint(cp);
  let pys;
  try {
    pys = pinyin(ch, { multiple: true, type: 'array', toneType: 'num' });
  } catch {
    pys = null;
  }
  if (!pys || pys.length === 0) continue;
  const clean = [...new Set(pys.map((p) => p.trim()).filter(Boolean))];
  if (clean.length === 0) continue;
  readings[ch] = clean;
  count++;
}
writeFileSync(join(root, 'src/rules/zh-pinyin.json'), JSON.stringify(readings));
console.log(`zh-pinyin.json: ${count} chars`);

// ---------- 2. 分词词典 ----------
// 词库来源：jieba 主词典（词 \t 频度 \t 词性）
const DICT_URL = 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt';
const res = await fetch(DICT_URL);
if (!res.ok) throw new Error(`fetch dict failed: ${res.status}`);
const text = await res.text();
const words = {};
const hanziRe = /^[\u4e00-\u9fa5]+$/;
for (const line of text.split('\n')) {
  const [w, f] = line.trim().split(/\s+/);
  if (!w || !f) continue;
  if (w.length < 2 || w.length > 6) continue; // 单字与超长词不用于连写分词
  if (!hanziRe.test(w)) continue;
  const freq = Number(f);
  if (!Number.isFinite(freq) || freq < 3) continue; // 保留较大词表，保证专业词（盲文/排版等）覆盖
  if (!words[w] || words[w] < freq) words[w] = freq;
}
// 按频度截取前 120000 条
const sorted = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 120000);
const dict = {};
for (const [w] of sorted) dict[w] = 1;
writeFileSync(join(root, 'src/rules/segment-dict.json'), JSON.stringify(dict));
console.log(`segment-dict.json: ${Object.keys(dict).length} words`);
