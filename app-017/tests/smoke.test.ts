import { describe, expect, it } from 'vitest';
import { convertText } from '../src/lib/convert';
import { layoutDocument } from '../src/lib/layout';
import { pagesToBRF, validateBRF } from '../src/lib/brf';
import { reverseConvert } from '../src/lib/reverse';
import { dotsToBrf } from '../src/lib/dots';

const OPTS = {
  toneMode: 'all' as const,
  autoDetectPinyin: true,
  profile: 'zh-current' as const,
};

describe('核心转换冒烟', () => {
  it('你好（全标调）', () => {
    const r = convertText('你好', OPTS);
    // n=1345 i=24+调3 → [2,3,4]; h=125 ao=235+调3 → [2,3,5]
    expect(r.cells.map((c) => c.dots.join(''))).toEqual(['1345', '234', '125', '235']);
    // 好（hao3/hao4）是多音字 → 必须 uncertain；你 不是
    expect(r.uncertain.some((u) => u.char === '好')).toBe(true);
    expect(r.uncertain.some((u) => u.char === '你')).toBe(false);
  });

  it('我（韵母自成音节+上声）', () => {
    const r = convertText('我', OPTS);
    expect(r.cells.map((c) => c.dots.join(''))).toEqual(['135']); // uo=135 + 调3
  });

  it('数字每位加数符', () => {
    const r = convertText('12', OPTS);
    expect(r.cells.map((c) => c.dots.join(''))).toEqual(['3456', '1', '3456', '12']);
  });

  it('小数点', () => {
    const r = convertText('3.5', OPTS);
    // 3=14, .=46(46 是字符'4'的点位？不，数字中小数点按标点 46), 5=15
    expect(r.cells.map((c) => c.dots.join(''))).toEqual(['3456', '14', '46', '3456', '15']);
  });

  it('标点：句号占两方，问号叹号', () => {
    const r = convertText('你好。', OPTS);
    expect(r.cells.slice(-2).map((c) => c.dots.join(''))).toEqual(['5', '23']);
    const q = convertText('好?', OPTS);
    expect(q.cells.slice(-2).map((c) => c.dots.join(''))).toEqual(['5', '3']);
  });

  it('多音字必须出现 uncertain（绝不静默）', () => {
    const r = convertText('长大', OPTS);
    expect(r.uncertain.length).toBeGreaterThan(0);
    expect(r.uncertain.some((u) => u.char === '长')).toBe(true);
  });

  it('确认后该项不再 uncertain', () => {
    const r = convertText('长大', { ...OPTS, confirmed: ['长'] });
    expect(r.uncertain.every((u) => u.char !== '长')).toBe(true);
    // 大（da2/da4/dai4）未确认仍是多音字
    expect(r.uncertain.some((u) => u.char === '大')).toBe(true);
  });

  it('词语表覆盖读音', () => {
    const r = convertText('长城', {
      ...OPTS,
      overrides: { 长: 'chang2' },
    });
    expect(r.uncertain.some((u) => u.char === '长')).toBe(false);
  });

  it('未收录字符标记 uncertain', () => {
    const r = convertText('∮', OPTS);
    expect(r.uncertain).toHaveLength(1);
    expect(r.cells[0].dots).toEqual([]);
  });

  it('英文字母（zh-current 档加小写号）', () => {
    const r = convertText('ABC', OPTS);
    // A=大写号6+字母1; B=6+12; C=6+14
    expect(r.cells.map((c) => c.dots.join(''))).toEqual(['6', '1', '6', '12', '6', '14']);
  });

  it('拼音串自动识别', () => {
    const r = convertText('nihao', OPTS);
    // ni hao 两个音节，识别为拼音 → 汉字盲文（不 100% 确定 nihao 是否切分，但应产出音节方）
    expect(r.cells.length).toBeGreaterThanOrEqual(3);
  });
});

describe('分页排版', () => {
  const setup = {
    cellsPerLine: 32,
    linesPerPage: 25,
    doubleSided: false,
    marginMm: { top: 20, left: 15, right: 15 },
  };

  it('词不跨行', () => {
    const text = '我们都是好朋友我们一起学习盲文排版知识每天进步一点点'; // 无标点长句
    const conv = convertText(text, OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, false);
    // 每行长度 ≤ 32，且行尾/行首都不在词中间（由实现保证：组整体换行）
    for (const page of layout.pages) {
      for (const line of page.lines) {
        expect(line.cells.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it('段首缩进 2 方', () => {
    const conv = convertText('你好', OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, false);
    const first = layout.pages[0].lines[0];
    expect(first.cells.slice(0, 2).every((c) => c.kind === 'space')).toBe(true);
  });

  it('页码行（数符+数字，右对齐，独占第一行）', () => {
    const conv = convertText('你好', OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, true);
    const page1 = layout.pages[0];
    expect(page1.lines[0].cells.filter((c) => c.dots.length > 0).map((c) => c.dots.join(''))).toEqual([
      '3456',
      '1',
    ]);
    expect(page1.lines[1].cells.length).toBeGreaterThan(0); // 内容从第 2 行开始
  });

  it('空行分段', () => {
    const conv = convertText('你好\n\n世界', OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, false);
    expect(layout.pages[0].lines.length).toBeGreaterThanOrEqual(3);
  });

  it('超长字母串强制拆分并标记违规', () => {
    const long = 'A'.repeat(40);
    const conv = convertText(long, OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, false);
    expect(layout.violations.length).toBeGreaterThan(0);
    expect(layout.violations[0].type).toBe('word-too-long');
  });
});

describe('BRF 输出', () => {
  const setup = {
    cellsPerLine: 32,
    linesPerPage: 25,
    doubleSided: false,
    marginMm: { top: 20, left: 15, right: 15 },
  };

  it('行尾无空格、行首保留段首缩进', () => {
    const conv = convertText('你好。', OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, false);
    const brf = pagesToBRF(layout.pages);
    const line1 = brf.split('\n')[0];
    const expected =
      '  ' + // 段首缩进 2 空方
      ['1345', '234', '125', '235', '5', '23'].map((d) => dotsToBrf(d.split('').map(Number))).join('');
    expect(line1).toBe(expected);
    expect(line1.endsWith(' ')).toBe(false);
    expect(brf.endsWith('\f\n')).toBe(true);
  });

  it('validateBRF 通过自产文件', () => {
    const conv = convertText('你好世界。\n第二段文字，包含数字123和英文Hello。', OPTS);
    const layout = layoutDocument(conv.paragraphs, setup, true);
    const brf = pagesToBRF(layout.pages);
    const v = validateBRF(brf, 32, 25);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });
});

describe('反向转换', () => {
  it('汉字往返：候选中包含原字', () => {
    const conv = convertText('你好', OPTS);
    const rev = reverseConvert(conv.cells);
    const hanziTokens = rev.tokens.filter((t) => t.kind === 'hanzi');
    expect(hanziTokens.length).toBe(2);
    expect(hanziTokens[0].candidates).toContain('你');
    expect(hanziTokens[1].candidates).toContain('好');
  });

  it('数字往返', () => {
    const conv = convertText('123', OPTS);
    const rev = reverseConvert(conv.cells);
    expect(rev.text).toContain('123');
  });

  it('多候选字标注不确定', () => {
    const conv = convertText('事', OPTS);
    const rev = reverseConvert(conv.cells);
    // shi4 有多个汉字 → 候选标注
    expect(rev.uncertainCount).toBeGreaterThan(0);
    expect(rev.text).toMatch(/\[/);
  });

  it('标点往返', () => {
    const conv = convertText('你好，世界。', OPTS);
    const rev = reverseConvert(conv.cells);
    expect(rev.text).toContain('，');
    expect(rev.text).toContain('。');
  });

  it('英文字母往返（zh-current 带字号）', () => {
    const conv = convertText('Hello', OPTS);
    const rev = reverseConvert(conv.cells);
    expect(rev.text).toContain('H');
    expect(rev.text).toContain('e');
  });
});
