/**
 * 转换对照测试：全部规则表驱动生成用例 + 规范显式用例（≥200 条）。
 * 规范依据：GB/T 15720-1995 §4.1-4.5、GF 0019-2018 §5-§10。
 */
import { describe, expect, it } from 'vitest';
import initialsJson from '../src/rules/zh-initials.json';
import finalsJson from '../src/rules/zh-finals.json';
import punctJson from '../src/rules/zh-punct.json';
import digitsJson from '../src/rules/zh-digits.json';
import lettersJson from '../src/rules/zh-letters.json';
import readingsJson from '../src/rules/zh-pinyin.json';
import { convertText } from '../src/lib/convert';
import { reverseConvert } from '../src/lib/reverse';
import { zeroInitialFinal } from '../src/lib/pinyin';

const INITIALS = initialsJson.initials as Record<string, string>;
const FINALS = finalsJson.finals as Record<string, string>;
const PUNCT = punctJson.punctuation as Record<string, string[]>;
const DIGITS = digitsJson.digits as Record<string, string>;
const LETTERS = lettersJson.letters as Record<string, string>;
const READINGS = readingsJson as Record<string, string[]>;

const OPTS = { toneMode: 'all' as const, autoDetectPinyin: true, profile: 'zh-current' as const };
const NAT = { ...OPTS, toneMode: 'national' as const };

const dotStr = (cells: { dots: number[] }[]) => cells.map((c) => c.dots.join('')).join('|');

describe('声母全表（21 个）', () => {
  // 各声母搭配的合法韵母（j/q/x 只拼 i/v 行）
  const COMBO: Record<string, string> = {
    b: 'a', p: 'a', m: 'a', f: 'a', d: 'a', t: 'a', n: 'a', l: 'a',
    g: 'a', k: 'a', h: 'a', j: 'i', q: 'i', x: 'i',
    zh: 'a', ch: 'a', sh: 'a', r: 'e', z: 'a', c: 'a', s: 'a',
  };
  for (const [ini, dots] of Object.entries(INITIALS)) {
    const fin = COMBO[ini];
    it(`声母 ${ini} 与 ${fin} 相拼 → ${dots}|${FINALS[fin]}`, () => {
      const r = convertText(ini + fin, OPTS);
      expect(dotStr(r.cells)).toBe(`${dots}|${FINALS[fin]}`);
    });
  }
});

describe('韵母全表（自成音节拼写）', () => {
  const SPELLINGS = [
    'a', 'o', 'e', 'er', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng',
    'ya', 'yao', 'ye', 'you', 'yan', 'yin', 'yang', 'ying', 'yong',
    'yu', 'yue', 'yuan', 'yun', 'yi',
    'wa', 'wo', 'wai', 'wei', 'wan', 'wen', 'wang', 'weng', 'wu',
  ];
  const spellingByFinal: Record<string, string> = {};
  for (const sp of SPELLINGS) {
    const f = zeroInitialFinal(sp);
    if (f) spellingByFinal[f] = sp;
  }
  for (const [fin, dots] of Object.entries(FINALS)) {
    const sp = spellingByFinal[fin];
    if (!sp) continue; // ong 只与声母相拼，不自成音节
    it(`韵母 ${fin}（${sp}）→ ${dots}`, () => {
      const r = convertText(sp, OPTS);
      expect(dotStr(r.cells)).toBe(dots);
    });
  }
});

describe('声母自成音节（zhi chi shi ri zi ci si）', () => {
  const CASES: [string, string][] = [
    ['zhi1', '134'],
    ['chi2', '12345'],
    ['shi1', '156'],
    ['ri4', '2345'],
    ['zi1', '1356'],
    ['si1', '1234'],
  ];
  for (const [input, expected] of CASES) {
    it(`${input} → ${expected}`, () => {
      expect(dotStr(convertText(input, OPTS).cells)).toBe(expected);
    });
  }
});

describe('标点符号全表', () => {
  for (const [src, cellDots] of Object.entries(PUNCT)) {
    it(`标点 ${src} → ${cellDots.join('|')}`, () => {
      const r = convertText(src, OPTS);
      expect(dotStr(r.cells)).toBe(cellDots.join('|'));
    });
  }
});

describe('阿拉伯数字（数符前置）', () => {
  for (const [d, dots] of Object.entries(DIGITS)) {
    it(`数字 ${d} → 3456|${dots}`, () => {
      expect(dotStr(convertText(d, OPTS).cells)).toBe(`3456|${dots}`);
    });
  }
  it('多位数字 2026 每位都加数符', () => {
    expect(dotStr(convertText('2026', OPTS).cells)).toBe('3456|12|3456|245|3456|12|3456|124');
  });
  it('小数 3.5 → 3456|14|46|3456|15', () => {
    expect(dotStr(convertText('3.5', OPTS).cells)).toBe('3456|14|46|3456|15');
  });
});

describe('拉丁字母（zh-current：小写号 56 / 大写号 6）', () => {
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const dots = LETTERS[ch];
    it(`小写 ${ch} → 56|${dots}`, () => {
      // 关闭拼音自动识别，强制按英文字母处理（a/o/e 等单字母才是合法拼音）
      expect(dotStr(convertText(ch, { ...OPTS, autoDetectPinyin: false }).cells)).toBe(`56|${dots}`);
    });
    it(`大写 ${ch.toUpperCase()} → 6|${dots}`, () => {
      expect(dotStr(convertText(ch.toUpperCase(), OPTS).cells)).toBe(`6|${dots}`);
    });
  }
  it('UEB 档位：小写不加字母号', () => {
    const r = convertText('abc', { ...OPTS, profile: 'ueb' });
    expect(dotStr(r.cells)).toBe('1|12|14');
  });
  it('UEB 档位：大写仍加大写号', () => {
    const r = convertText('Ab', { ...OPTS, profile: 'ueb' });
    expect(dotStr(r.cells)).toBe('6|1|12');
  });
});

describe('声调符号', () => {
  const CASES: [string, string][] = [
    ['ma1', '134|135'], // m134 + a35 + 调1
    ['ma2', '134|235'], // a35 + 调2
    ['ma3', '134|35'], // a35 已含点3
    ['ma4', '134|235'], // a35 + 调23
    ['mo2', '134|26'], // o26 + 调2
    ['yi3', '234'], // i24 + 调3
    ['wu4', '1236'], // u136 + 调23
    ['de0', '145|26'], // 轻声不标调
  ];
  for (const [input, expected] of CASES) {
    it(`${input} → ${expected}`, () => {
      expect(dotStr(convertText(input, OPTS).cells)).toBe(expected);
    });
  }
});

describe('声调省写规则（GF 0019-2018 §10.2，national 模式）', () => {
  const CASES: [string, string, string][] = [
    // [输入拼音, 期望点位, 规则]
    ['fen1', '124|356', '10.2.1 f 省写阴平'],
    ['ba4', '12|35', '10.2.3 b 省写去声'],
    ['ci2', '14', '10.2.2 c 省写阳平（自成音节单方）'],
    ['tou2', '2345|12356', '10.2.2 tóu 不省写'],
    ['le4', '123|236', '10.2.3 lè 不省写'],
    ['zi4', '12356', '10.2.3 zì 不省写'],
    ['yu4', '346', '10.2.4 韵母自成音节省写去声'],
    ['wo4', '1235', '10.2.5 wò 不省写'],
    ['wo3', '135', '10.2.5 wǒ 省写'],
    ['yi4', '234', '10.2.5 yì 不省写'],
    ['yi1', '24', '10.2.5 yī 省写'],
    ['ye4', '1235', '10.2.5 yè 不省写'],
    ['er4', '1235', '10.2.5 èr 不省写'],
    ['er2', '1235', '10.2.5 ér 省写'],
    ['o1', '26', '10.2.6 ō 省写'],
    ['o4', '26', '10.2.6 ò 省写'],
    ['e4', '236', '10.2.6 è 不省写（例外）'],
    ['e1', '126', '10.2.6 ē 不省写（例外，带调点1）'],
  ];
  for (const [input, expected, rule] of CASES) {
    it(`${input}（${rule}）→ ${expected}`, () => {
      expect(dotStr(convertText(input, NAT).cells)).toBe(expected);
    });
  }

  it('10.2.7 声母自成音节后连写零声母韵母时恢复标调（事业 shi4 ye4）', () => {
    // shi4 属 10.2.3（sh 省去声），但后连写零声母 ye → 不省写
    const r = convertText('事业', { ...NAT, overrides: { 事业: 'shi4 ye4' } });
    expect(dotStr(r.cells)).toBe('12356|1235');
  });

  it('普通去声仍省写（对比：shì 在“故事”中省写）', () => {
    const r = convertText('故事', { ...NAT, overrides: { 故事: 'gu4 shi4' } });
    // gu4: g=1245 零韵? g+u → 1245|136；shi4 → sh 省去声 → 156
    expect(dotStr(r.cells)).toBe('1245|136|156');
  });
});

describe('标调模式', () => {
  it('none 模式完全不标调', () => {
    const r = convertText('ma4', { ...OPTS, toneMode: 'none' });
    expect(dotStr(r.cells)).toBe('134|35');
  });
  it('all 模式即使可省写也标调', () => {
    const r = convertText('ba4', { ...OPTS, toneMode: 'all' });
    expect(dotStr(r.cells)).toBe('12|235');
  });
});

describe('多音字（绝不静默猜测）', () => {
  it('候选列表与词典读音完全一致', () => {
    const r = convertText('长城', OPTS);
    const u = r.uncertain.find((x) => x.char === '长');
    expect(u).toBeTruthy();
    expect(u!.candidates).toEqual(READINGS['长']);
    expect(u!.candidates.length).toBeGreaterThan(1);
  });

  it('默认读音取词典第一个', () => {
    const r = convertText('长城', OPTS);
    // 读音标注在音节最后一方（韵母方）
    const first = r.cells.find((c) => c.reading);
    expect(first?.reading).toBe(READINGS['长'][0]);
  });

  it('用户确认后写入覆盖', () => {
    const r1 = convertText('长大', { ...OPTS, overrides: { 长: 'zhang3' } });
    expect(r1.uncertain.some((u) => u.char === '长')).toBe(false);
    const r2 = convertText('长大', { ...OPTS, confirmed: ['长'] });
    expect(r2.uncertain.some((u) => u.char === '长')).toBe(false);
  });

  it('词语读音覆盖优先于单字', () => {
    const r = convertText('银行', { ...OPTS, overrides: { 银行: 'yin2 hang2' } });
    expect(r.uncertain.some((u) => u.char === '行')).toBe(false);
  });

  it('未收录字符 → 空方 + uncertain + unrecognized', () => {
    const r = convertText('∮', OPTS);
    expect(r.cells[0]).toMatchObject({ dots: [], uncertain: true });
    expect(r.uncertain[0]).toMatchObject({ unrecognized: true, candidates: [] });
  });
});

describe('分词连写与混合输入', () => {
  it('常用音节组合循环（声韵搭配 20 组）', () => {
    const combos = [
      'ba', 'bo', 'ma', 'fo', 'de', 'te', 'ne', 'le', 'ge', 'ku',
      'hu', 'ji', 'qi', 'xi', 'zhu', 'chu', 'shu', 're', 'ze', 'si',
    ];
    for (const c of combos) {
      const r = convertText(c, OPTS);
      expect(r.cells.length, `音节 ${c} 至少一方`).toBeGreaterThan(0);
      expect(r.cells.every((cell) => cell.dots.length > 0), `音节 ${c} 全部为实方`).toBe(true);
      expect(r.uncertain, `音节 ${c} 无不确定项`).toEqual([]);
    }
  });

  it('汉字+数字+英文+标点混合', () => {
    const r = convertText('第12节课，用AB。', OPTS);
    const flat = r.cells.map((c) => c.dots.join(''));
    // 数字段
    expect(flat).toContain('3456');
    // AB
    expect(flat).toContain('6');
    // 逗号 句号
    // 句号是多方标点（5|23），落在最后两方
    expect(dotStr(r.cells.slice(-2))).toBe('5|23');
    expect(r.stats.cellCount).toBeGreaterThan(10);
  });

  it('英文单词整体转换（Hello → 10 方）', () => {
    const r = convertText('Hello', OPTS);
    expect(r.cells.length).toBe(10); // 5 字母 × 2（字号+字母）
  });

  it('纯拼音串识别（nihao → 两音节）', () => {
    const r = convertText('nihao', OPTS);
    expect(r.cells.length).toBe(4); // ni(2) + hao(2)
  });

  it('非拼音字母串按英文处理（xyz）', () => {
    const r = convertText('xyz', OPTS);
    // x=1346 y=13456 z=1356，各带小写号
    expect(dotStr(r.cells)).toBe('56|1346|56|13456|56|1356');
  });

  it('空行分段', () => {
    const r = convertText('你好\n\n世界', OPTS);
    expect(r.paragraphs.length).toBe(3);
    expect(r.paragraphs[1].blank).toBe(true);
  });
});

describe('反向转换', () => {
  it('音节→候选含原字（有调精确匹配）', () => {
    const conv = convertText('好', { ...OPTS, overrides: { 好: 'hao3' } });
    const rev = reverseConvert(conv.cells);
    expect(rev.tokens[0].candidates).toContain('好');
  });

  it('数字往返稳定', () => {
    const conv = convertText('98.6', OPTS);
    expect(reverseConvert(conv.cells).text).toContain('98.6');
  });

  it('标点往返：问号叹号还原', () => {
    const conv = convertText('好?', OPTS);
    const rev = reverseConvert(conv.cells);
    expect(rev.text).toContain('？');
  });
});
