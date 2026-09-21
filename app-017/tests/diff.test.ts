/**
 * 版本对比引擎测试。
 * 覆盖需求：按方比出新加 / 删除 / 换读音，给出页/行/方；整段移动、一段拆两段不算改动；
 * 选择性搬移后重比；差得太多/对不上号时区分错位与真改动。
 */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../src/types';
import { extractModel, compareDocs, formatPos, type DiffOptions } from '../src/lib/diff';
import { applySelectedChanges } from '../src/lib/patch';

const OPTS: DiffOptions = {
  toneMode: 'all',
  autoDetectPinyin: true,
  showPageNumbers: true,
};

const SETUP = {
  cellsPerLine: 32,
  linesPerPage: 25,
  doubleSided: false,
  marginMm: { top: 20, left: 15, right: 15 },
};

function doc(raw: string, overrides?: Record<string, string>, confirmed?: string[]): Doc {
  return {
    id: `d${Math.random().toString(36).slice(2)}`,
    title: 't',
    raw,
    cells: [],
    setup: { ...SETUP },
    ruleProfile: 'zh-current',
    updatedAt: 0,
    overrides,
    confirmed,
  };
}

const kinds = (r: ReturnType<typeof compareDocs>, k: string) => r.changes.filter((c) => c.kind === k);

describe('模型抽取：语义单元与页/行/方', () => {
  it('每个汉字是一个带读音的单元', () => {
    const m = extractModel(doc('你好世界'), OPTS);
    expect(m.units.map((u) => u.source)).toEqual(['你', '好', '世', '界']);
    expect(m.units.every((u) => u.reading.length > 0)).toBe(true);
  });

  it('多字词逐字切分且每字至少占一方', () => {
    const m = extractModel(doc('特殊教育学校'), OPTS);
    expect(m.units.map((u) => u.source)).toEqual(['特', '殊', '教', '育', '学', '校']);
    expect(m.units.every((u) => u.cellIds.length >= 1)).toBe(true);
  });

  it('数字 / 字母 / 标点为不同种类的单元', () => {
    const m = extractModel(doc('有12个AB。'), OPTS);
    expect(m.units.map((u) => u.kind)).toEqual(['hanzi', 'digit', 'hanzi', 'letter', 'punct']);
  });

  it('位置可反查到 页/行/方（页码行占第 1 行、缩进 2 方）', () => {
    const m = extractModel(doc('你好世界'), OPTS);
    expect(m.positions.get(m.units[0].cellIds[0])).toEqual({ page: 1, line: 2, cell: 3 });
  });

  it('缩进空方与页码方不占内容方序号', () => {
    const m = extractModel(doc('你好世界'), OPTS);
    // 你/好/界 各 2 方；「世」zhi 类声母自成音节只占 1 方 → 共 7 个内容方
    expect(m.cellCount).toBe(7);
  });

  it('原文偏移可还原原句', () => {
    const m = extractModel(doc('你好世界，盲文。'), OPTS);
    expect(m.units.map((u) => u.source).join('')).toContain('你好世界');
  });
});

describe('三类真实改动', () => {
  it('新加方：仅报告新增字', () => {
    const r = compareDocs(extractModel(doc('你好世界'), OPTS), extractModel(doc('你好美丽世界'), OPTS));
    expect(kinds(r, 'added').map((c) => c.source)).toEqual(['美', '丽']);
    expect(r.summary).toMatchObject({ added: 2, removed: 0, reading: 0 });
  });

  it('删掉方：仅报告删除字', () => {
    const r = compareDocs(extractModel(doc('你好美丽世界'), OPTS), extractModel(doc('你好世界'), OPTS));
    expect(kinds(r, 'removed').map((c) => c.source)).toEqual(['美', '丽']);
    expect(r.summary).toMatchObject({ removed: 2, added: 0 });
  });

  it('换读音：同字不同音报 reading 且双方位置都给', () => {
    const a = extractModel(doc('长大', { 长: 'chang2' }, ['长', '大']), OPTS);
    const b = extractModel(doc('长大', { 长: 'zhang3' }, ['长', '大']), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ kind: 'reading', source: '长', oldReading: 'chang2', newReading: 'zhang3' });
    expect(r.changes[0].oldCells[0].pos).toBeTruthy();
    expect(r.changes[0].newCells[0].pos).toBeTruthy();
  });

  it('每条改动都带至少一个页/行/方定位', () => {
    const r = compareDocs(extractModel(doc('你好世界'), OPTS), extractModel(doc('你好朋友们世界'), OPTS));
    for (const c of r.changes) {
      const refs = [...c.oldCells, ...c.newCells];
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.some((x) => x.pos)).toBe(true);
      expect(formatPos(refs.find((x) => x.pos)!)).toMatch(/^第 \d+ 页第 \d+ 行第 \d+ 方$/);
    }
  });

  it('替换：旧句一段被改写 → 同时报删除与新加', () => {
    const r = compareDocs(
      extractModel(doc('我们学习盲文排版'), OPTS),
      extractModel(doc('我们练习点字打印'), OPTS),
    );
    expect(kinds(r, 'removed').length).toBeGreaterThan(0);
    expect(kinds(r, 'added').length).toBeGreaterThan(0);
  });
});

describe('结构位移不算改动', () => {
  it('整段挪位置 → moved，零内容改动', () => {
    const a = extractModel(doc('第一段内容。\n\n第二段内容。'), OPTS);
    const b = extractModel(doc('第二段内容。\n\n第一段内容。'), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes).toHaveLength(0);
    expect(r.events.every((e) => e.type === 'moved' && !e.contentChanged)).toBe(true);
  });

  it('三段重排：全部识别为 moved', () => {
    const a = extractModel(doc('甲段内容。\n\n乙段内容。\n\n丙段内容。'), OPTS);
    const b = extractModel(doc('丙段内容。\n\n甲段内容。\n\n乙段内容。'), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes).toHaveLength(0);
    expect(r.events).toHaveLength(3);
  });

  it('一段拆成两段 → split，零改动', () => {
    const a = extractModel(doc('盲文是触觉文字，特殊教育学校常用。'), OPTS);
    const b = extractModel(doc('盲文是触觉文字，\n\n特殊教育学校常用。'), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes).toHaveLength(0);
    expect(r.events.find((e) => e.type === 'split')?.contentChanged).toBe(false);
  });

  it('两段合成一段 → merge，零改动', () => {
    const a = extractModel(doc('盲文是触觉文字，\n\n特殊教育学校常用。'), OPTS);
    const b = extractModel(doc('盲文是触觉文字，特殊教育学校常用。'), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'merge')).toBe(true);
  });

  it('拆段的同时段内真改了字 → 结构事件 + 仅报改动字', () => {
    const a = extractModel(doc('盲文是触觉文字，特殊教育学校常用。'), OPTS);
    const b = extractModel(doc('盲文是触觉文字，\n\n特殊教育学校好用。'), OPTS);
    const r = compareDocs(a, b);
    expect(kinds(r, 'removed').map((c) => c.source)).toContain('常');
    expect(kinds(r, 'added').map((c) => c.source)).toContain('好');
    expect(r.events.find((e) => e.type === 'split')?.contentChanged).toBe(true);
  });

  it('整段移动且段内加了字 → moved 标记 + 只报加的字', () => {
    const a = extractModel(doc('开篇的话。\n\n移动这段内容。'), OPTS);
    const b = extractModel(doc('移动这段新内容。\n\n开篇的话。'), OPTS);
    const r = compareDocs(a, b);
    expect(r.events.some((e) => e.type === 'moved')).toBe(true);
    expect(kinds(r, 'added').map((c) => c.source)).toContain('新');
  });
});

describe('错位 vs 真改动', () => {
  it('两篇完全不同的稿子 → error（疑似选错文档/整体重写）', () => {
    const a = extractModel(doc('春天来了花儿开了大雁往南飞'), OPTS);
    const b = extractModel(doc('今天午餐吃红烧肉和米饭汤'), OPTS);
    const r = compareDocs(a, b);
    expect(r.warnings.some((w) => w.level === 'error')).toBe(true);
    expect(r.summary.similarity).toBeLessThan(0.34);
  });

  it('差异较大但仍是同一篇 → 不报 error（可给 warn）', () => {
    const same = '特殊教育学校开展盲文教学需要大量点字教材志愿者参与活动';
    // 仅改写中间一小段、首尾保留：仍是同一篇，相似度高于完全重写阈值
    const edited = '特殊教育学校开展音乐美术课程缺少点字教材志愿者参与活动';
    const r = compareDocs(extractModel(doc(same), OPTS), extractModel(doc(edited), OPTS));
    expect(r.summary.similarity).toBeGreaterThanOrEqual(0.34);
    expect(r.warnings.some((w) => w.level === 'error')).toBe(false);
  });

  it('局部对不上号的长替换块逐条标 suspicious', () => {
    const a = extractModel(doc('我们都是好朋友一起学习盲文知识'), OPTS);
    const b = extractModel(doc('我们都是好朋友共同练习点字技能'), OPTS);
    const r = compareDocs(a, b);
    expect(r.changes.some((c) => c.suspicious)).toBe(true);
    expect(r.warnings.some((w) => w.message.includes('疑似错位'))).toBe(true);
  });

  it('篇幅相差 4 倍以上 → 长度悬殊提醒', () => {
    const a = extractModel(doc('短句子'), OPTS);
    const long = extractModel(doc('特殊教育学校开展盲文教学需要大量点字教材志愿者参与了整学期工作。'.repeat(6)), OPTS);
    const r = compareDocs(a, long);
    expect(r.warnings.some((w) => w.message.includes('篇幅相差悬殊'))).toBe(true);
  });

  it('完全相同的两版 → 无改动、无警告、相似度 1', () => {
    const d = '同一份稿子的内容，一点没动。';
    const r = compareDocs(extractModel(doc(d), OPTS), extractModel(doc(d), OPTS));
    expect(r.changes).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.summary.similarity).toBe(1);
  });
});

describe('选择性搬移（搬完重比）', () => {
  it('把新加的字搬进旧版 → 重比无差异', () => {
    const oldD = doc('你好世界');
    const newD = doc('你好美丽世界');
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('new-to-old', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.raw).toBe('你好美丽世界');
    expect(compareDocs(extractModel(report.doc, OPTS), nm0).changes).toHaveLength(0);
  });

  it('把删除同步到旧版（新版→旧版）→ 重比无差异', () => {
    const oldD = doc('你好美丽世界');
    const newD = doc('你好世界');
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('new-to-old', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.raw).toBe('你好世界');
    expect(compareDocs(extractModel(report.doc, OPTS), nm0).changes).toHaveLength(0);
  });

  it('把误删内容恢复回新版（旧版→新版）→ 重比无差异', () => {
    const oldD = doc('你好美丽世界');
    const newD = doc('你好世界');
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('old-to-new', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.raw).toBe('你好美丽世界');
    expect(compareDocs(om0, extractModel(report.doc, OPTS)).changes).toHaveLength(0);
  });

  it('新读音搬进旧版 overrides 并自动确认 → 重比无差异', () => {
    const oldD = doc('长大', { 长: 'chang2' }, ['长', '大']);
    const newD = doc('长大', { 长: 'zhang3' }, ['长', '大']);
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('new-to-old', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.overrides?.['长']).toBe('zhang3');
    expect(report.doc.confirmed).toContain('长');
    expect(compareDocs(extractModel(report.doc, OPTS), nm0).changes).toHaveLength(0);
  });

  it('旧版→新版 换读音按方向恢复为旧读音', () => {
    const oldD = doc('长大', { 长: 'chang2' }, ['长', '大']);
    const newD = doc('长大', { 长: 'zhang3' }, ['长', '大']);
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('old-to-new', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.overrides?.['长']).toBe('chang2');
    expect(compareDocs(om0, extractModel(report.doc, OPTS)).changes).toHaveLength(0);
  });

  it('只搬勾选的一条，其余改动保留', () => {
    const oldD = doc('你好世界和平');
    const newD = doc('你好美丽世界安宁');
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const justMei = r0.changes.filter((c) => c.source === '美');
    expect(justMei).toHaveLength(1);
    const report = applySelectedChanges('new-to-old', justMei, oldD, om0, newD, nm0);
    expect(report.doc.raw).toBe('你好美世界和平');
    const rest = compareDocs(extractModel(report.doc, OPTS), nm0);
    expect(kinds(rest, 'added').map((c) => c.source).sort()).toEqual(['丽', '宁', '安']);
  });

  it('连续新增多字作为整块插入，顺序不乱', () => {
    const oldD = doc('甲乙');
    const newD = doc('甲子丑乙');
    const om0 = extractModel(oldD, OPTS);
    const nm0 = extractModel(newD, OPTS);
    const r0 = compareDocs(om0, nm0);
    const report = applySelectedChanges('new-to-old', r0.changes, oldD, om0, newD, nm0);
    expect(report.doc.raw).toBe('甲子丑乙');
  });

  it('搬完一次后再次对比，已搬条目不再出现', () => {
    const oldD = doc('我们学习盲文');
    const newD = doc('我们学习点字');
    let om = extractModel(oldD, OPTS);
    const nm = extractModel(newD, OPTS);
    let r = compareDocs(om, nm);
    const added = r.changes.filter((c) => c.kind === 'added');
    const rep1 = applySelectedChanges('new-to-old', added, oldD, om, newD, nm);
    om = extractModel(rep1.doc, OPTS);
    r = compareDocs(om, nm);
    expect(kinds(r, 'added')).toHaveLength(0);
    expect(kinds(r, 'removed').length).toBeGreaterThan(0);
  });
});
