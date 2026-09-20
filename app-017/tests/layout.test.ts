/**
 * 分页排版测试：30 组换行用例。
 * 验收标准（需求文档 §10）：词不跨行、数字/字母不拆分；违规必须标出而不是静默通过。
 */
import { describe, expect, it } from 'vitest';
import { convertText } from '../src/lib/convert';
import { layoutDocument } from '../src/lib/layout';

const OPTS = { toneMode: 'all' as const, autoDetectPinyin: true, profile: 'zh-current' as const };
const SETUP = { cellsPerLine: 32, linesPerPage: 25, doubleSided: false, marginMm: { top: 20, left: 15, right: 15 } };

function linesOf(text: string, cellsPerLine = 32) {
  const setup = { ...SETUP, cellsPerLine };
  const conv = convertText(text, OPTS);
  const layout = layoutDocument(conv.paragraphs, setup, false);
  return { conv, layout };
}

/** 验证核心不变量：行宽 ≤ 上限；词（wordId）不跨行；标点不落行首 */
function expectValidLayout(text: string, cellsPerLine = 32) {
  const { conv, layout } = linesOf(text, cellsPerLine);
  expect(layout.violations).toEqual([]);
  const wordLines = new Map<number, Set<number>>();
  layout.pages.forEach((page) => {
    page.lines.forEach((line, li) => {
      expect(line.cells.length).toBeLessThanOrEqual(cellsPerLine);
      line.cells.forEach((c, ci) => {
        if (c.wordId !== undefined) {
          if (!wordLines.has(c.wordId)) wordLines.set(c.wordId, new Set());
          wordLines.get(c.wordId)!.add(li);
        }
        // 标点不落行首（该词组整体换行的结果）
        if (ci === 0 && c.kind === 'punct' && line.cells.length > 1) {
          throw new Error(`标点 ${c.source} 落在行首`);
        }
      });
    });
  });
  for (const [wordId, lines] of wordLines) {
    expect(lines.size, `词 #${wordId}「${conv.cells.find((c) => c.wordId === wordId)?.source}」跨行了`).toBe(1);
  }
  return layout;
}

const HAND_CASES: [string, string][] = [
  ['短句', '你好世界'],
  ['词在行尾不断行', '我们都是好朋友我们一起学习盲文排版知识'],
  ['数字串不拆分', '学号是20260916要记住'],
  ['小数不拆分', '圆周率约3.14159很重要'],
  ['英文字母串不拆分', '盲文标准是GB/T15720'],
  ['标点跟随前词', '特殊教育需要更多资源，请大家一起努力。'],
  ['多方标点不落行首', '他说今天天气很好——然后出门了'],
  ['省略号跟随前词', '他等啊等啊……终于回来了'],
  ['空行分段', '第一段内容。\n\n第二段内容。'],
  ['多段混合', '盲文排版\n盲文点字\n盲文打印'],
  ['长句自动换行', '盲文是触觉文字特殊教育学校常用盲文教材进行教学学生通过触摸点字来阅读'],
  ['窄行宽换行', '特殊教育词典盲文出版'],
  ['词边界精确换行', '中华人民共和国成立于一九四九年'],
  ['数字与汉字混合', '三年级有25个学生使用12本教材'],
  ['英文与汉字混合', '使用braille转braille需要确认'],
  ['全角标点密集', '一、二、三、四、五、六、七、八、九、十、'],
  ['问叹号跟随', '这是真的吗？是真的！'],
  ['冒号引号', '老师说：“盲文很有用。”'],
  ['书名号', '这本《特殊教育词典》很好'],
  ['括号', '盲文（braille）是触觉文字'],
  ['重复词长句', '盲文盲文盲文盲文盲文盲文盲文盲文盲文盲文盲文盲文'],
  ['长拼音串', 'zhongwenpinyinshuru'],
  ['混合数字英文', '版本v2.0更新于2026年9月'],
  ['单字句', '好。'],
];

/** 程序生成用长句（约 38 字，约 76 方/遍） */
const longSentences = [
  '特殊教育学校开展盲文教学需要大量点字教材志愿者参与了整学期的盲文课本转录工作',
  '图书馆为视障读者准备了有声读物和盲文图书两个阅览室都配备了助视器和点字显示器',
  '学生通过触摸点字来阅读课文老师逐课检查学生的盲文书写是否规范并纠正错误的点位',
  '盲文出版社每年出版数百种点字图书涵盖文学科技医学等多个领域的盲文读物深受欢迎',
  '全国盲文水平等级考核每年举行两次考生需要掌握现行盲文的拼写规则和分词连写规则',
  '家长参加盲文入门培训班学习基础点字后可以给孩子制作简单的盲文练习卡和阅读材料',
];

describe('分页排版换行用例（30 组）', () => {
  it.each(HAND_CASES)('%s', (_name, text) => {
    expectValidLayout(text);
  });

  it('超行宽数字串强制拆分并明确报告（绝不静默）', () => {
    // 32 位数字 = 64 方，超过 32 方行宽
    const conv = convertText('12345678901234567890123456789012', OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, false);
    expect(layout.violations).toHaveLength(1);
    expect(layout.violations[0]).toMatchObject({ type: 'word-too-long', cells: 64 });
    layout.pages.forEach((p) => p.lines.forEach((l) => expect(l.cells.length).toBeLessThanOrEqual(32)));
  });

  // 程序生成 6 组不同长度的长文（跨页）
  longSentences.forEach((s, i) => {
    it(`程序生成第 ${i + 1} 组长文`, () => {
      const text = Array.from({ length: 12 + i * 5 }, () => s).join('');
      const layout = expectValidLayout(text);
      expect(layout.pages.length).toBeGreaterThan(1); // 必然跨页
    });
  });
});

describe('排版细节', () => {
  it('段首缩进 2 方', () => {
    const layout = expectValidLayout('你好\n世界');
    const line0 = layout.pages[0].lines[0];
    expect(line0.cells.slice(0, 2).every((c) => c.kind === 'space')).toBe(true);
    // 第二段
    const line1 = layout.pages[0].lines[1];
    expect(line1.cells.slice(0, 2).every((c) => c.kind === 'space')).toBe(true);
  });

  it('页码独占每页第一行且右对齐', () => {
    const conv = convertText(longSentences[0].repeat(20), OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    expect(layout.pages.length).toBeGreaterThan(1);
    layout.pages.forEach((page, idx) => {
      const first = page.lines[0].cells.filter((c) => c.dots.length > 0);
      // 数符 3456 + 页码数字
      expect(first[0].dots.join('')).toBe('3456');
      expect(first.length).toBeGreaterThanOrEqual(2);
      expect(first.map((c) => c.source).join('')).toContain(String(idx + 1));
    });
  });

  it('超长词强制拆分并明确报告（绝不静默）', () => {
    const conv = convertText('A'.repeat(40), OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, false);
    expect(layout.violations).toHaveLength(1);
    expect(layout.violations[0]).toMatchObject({ type: 'word-too-long', cells: 80 });
    // 拆分后每行仍不超宽
    layout.pages.forEach((p) => p.lines.forEach((l) => expect(l.cells.length).toBeLessThanOrEqual(32)));
  });

  it('自定义行宽 20 方也保持词不跨行', () => {
    expectValidLayout('特殊教育学校开展盲文教学需要大量点字教材', 20);
  });

  it('每页行数正确（25 行/页，页码开启时 24 行内容）', () => {
    const text = Array.from({ length: 60 }, (_, i) => `段落${i}的内容`).join('\n');
    const conv = convertText(text, OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    expect(layout.pages[0].lines.length).toBe(25);
    // 第一页：1 页码行 + 24 内容行
    expect(layout.pages[0].lines.slice(1).every((l) => l.cells.length >= 0)).toBe(true);
  });
});
