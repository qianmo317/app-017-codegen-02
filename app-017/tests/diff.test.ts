/**
 * 版本对比测试：新增/删除/换读音的识别与定位、移动与段落拆分不计改动、
 * 改动逐条应用（正向/反向）、无法对齐与疑似错位的提示。
 */
import { describe, expect, it } from 'vitest';
import type { Doc } from '../src/types';
import { convertText } from '../src/lib/convert';
import { layoutDocument } from '../src/lib/layout';
import { diffDocuments, applyChanges } from '../src/lib/diff';

const OPTS = { toneMode: 'all' as const, autoDetectPinyin: true, profile: 'zh-current' as const };
const SETUP = { cellsPerLine: 32, linesPerPage: 25, doubleSided: false, marginMm: { top: 20, left: 15, right: 15 } };

let seq = 0;
function mkDoc(raw: string, extra?: Partial<Doc>): Doc {
  return {
    id: `t${seq++}`,
    title: '测试',
    raw,
    cells: [],
    setup: { ...SETUP },
    ruleProfile: 'zh-current',
    updatedAt: 0,
    overrides: {},
    confirmed: [],
    ...extra,
  };
}

const optsFor = (d: Doc) => ({ ...OPTS, overrides: d.overrides, confirmed: d.confirmed });
const diff = (a: Doc, b: Doc) => diffDocuments(a, b, optsFor(a), optsFor(b), false);

describe('逐字比对：新增 / 删除 / 换读音', () => {
  it('中间插入两字 → 1 处新增，内容正确', () => {
    const r = diff(mkDoc('我们明天去公园。'), mkDoc('我们明天一起去公园。'));
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].kind).toBe('added');
    expect(r.changes[0].text).toBe('一起');
    expect(r.changes[0].locB?.page).toBe(1);
  });

  it('删掉两字 → 1 处删除', () => {
    const r = diff(mkDoc('我们明天一起去公园。'), mkDoc('我们明天去公园。'));
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].kind).toBe('deleted');
    expect(r.changes[0].text).toBe('一起');
    expect(r.changes[0].locA?.page).toBe(1);
  });

  it('同一字换读音 → 记为换读音，不算增删', () => {
    const a = mkDoc('长城很长。');
    const b = mkDoc('长城很长。', { overrides: { 长: 'zhang3' }, confirmed: ['长'] });
    const r = diff(a, b);
    expect(r.changes.length).toBe(2); // 两个「长」
    for (const c of r.changes) {
      expect(c.kind).toBe('modified');
      expect(c.text).toBe('长');
      expect(c.readingA).toBe('chang2');
      expect(c.readingB).toBe('zhang3');
    }
  });

  it('完全相同的文档 → 无任何改动', () => {
    const r = diff(mkDoc('一样的内容。'), mkDoc('一样的内容。'));
    expect(r.changes).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });
});

describe('移动与段落调整不计为改动', () => {
  it('整段挪位置 → 无改动，记为移动', () => {
    const a = mkDoc('第一段话。\n第二段话在这里。\n第三段。');
    const b = mkDoc('第二段话在这里。\n第一段话。\n第三段。');
    const r = diff(a, b);
    expect(r.changes).toHaveLength(0);
    const moved = r.infos.filter((i) => i.kind === 'moved');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved[0].text).toContain('段话');
  });

  it('一段拆成两段 → 无改动，记为分段', () => {
    const r = diff(mkDoc('今天天气很好。我们去公园。'), mkDoc('今天天气很好。\n我们去公园。'));
    expect(r.changes).toHaveLength(0);
    expect(r.infos.some((i) => i.kind === 'split')).toBe(true);
  });

  it('两段并成一段 → 无改动，记为并段', () => {
    const r = diff(mkDoc('今天天气很好。\n我们去公园。'), mkDoc('今天天气很好。我们去公园。'));
    expect(r.changes).toHaveLength(0);
    expect(r.infos.some((i) => i.kind === 'merged')).toBe(true);
  });

  it('并段发生在模糊配对段落之后 → 下标不错位', () => {
    // 第一段字数不同（模糊配对），第二、三段在 B 中合并
    const a = mkDoc('今天我们一起去公园玩。\n第二段甲。\n第三段乙。');
    const b = mkDoc('今天我们大家一起去公园玩。\n第二段甲。第三段乙。');
    const r = diff(a, b);
    // 只有第一段的「大家」一处新增，并段不产生多余改动
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].kind).toBe('added');
    expect(r.changes[0].text).toBe('大家');
    expect(r.infos.some((i) => i.kind === 'merged')).toBe(true);
  });
});

describe('改动位置：第几页第几行第几方', () => {
  it('新增的字定位到版本B的版面位置', () => {
    const setup = { ...SETUP, cellsPerLine: 10, linesPerPage: 2 };
    const a = mkDoc('你好。', { setup });
    const b = mkDoc('你很好。', { setup });
    const r = diff(a, b);
    expect(r.changes).toHaveLength(1);
    // 独立验证：用同一份转换结果排版，找到「很」的第一个方在版面中的位置
    const convB = convertText('你很好。', OPTS);
    const layoutB = layoutDocument(convB.paragraphs, setup, false);
    const henCell = convB.paragraphs[0].words.flatMap((w) => w.cells).find((c) => c.source === '很')!;
    let expected: { page: number; line: number; cell: number } | undefined;
    for (const p of layoutB.pages) {
      p.lines.forEach((line, li) => {
        const idx = line.cells.indexOf(henCell);
        if (idx >= 0) expected = { page: p.number, line: li + 1, cell: idx + 1 };
      });
    }
    expect(expected).toBeDefined();
    expect(r.changes[0].locB).toEqual(expected);
    expect(r.changes[0].locB?.page).toBe(1);
    expect(r.changes[0].locB?.line).toBe(1);
  });

  it('删除的字定位到版本A的版面位置', () => {
    const r = diff(mkDoc('你很好。'), mkDoc('你好。'));
    expect(r.changes[0].kind).toBe('deleted');
    expect(r.changes[0].locA).toBeDefined();
    expect(r.changes[0].locB).toBeUndefined();
  });
});

describe('逐条应用改动并复比', () => {
  it('把新增搬到版本A：原文一致，复比无改动', () => {
    const a = mkDoc('我们明天去公园。');
    const b = mkDoc('我们明天一起去公园。');
    const r1 = diff(a, b);
    const applied = applyChanges(a, r1.changes, 'forward');
    expect(applied.raw).toBe('我们明天一起去公园。');
    const r2 = diff(mkDoc(applied.raw, { overrides: applied.overrides }), b);
    expect(r2.changes).toHaveLength(0);
  });

  it('从版本B撤掉新增：回到版本A的原文', () => {
    const a = mkDoc('我们明天去公园。');
    const b = mkDoc('我们明天一起去公园。');
    const r1 = diff(a, b);
    const applied = applyChanges(b, r1.changes, 'reverse');
    expect(applied.raw).toBe('我们明天去公园。');
  });

  it('整段插入（带段落换行）搬到版本A', () => {
    const a = mkDoc('开头。结尾。');
    const b = mkDoc('开头。\n新加的一段。\n结尾。');
    const r1 = diff(a, b);
    expect(r1.changes).toHaveLength(1);
    const applied = applyChanges(a, r1.changes, 'forward');
    expect(applied.raw).toBe(b.raw);
    expect(diff(mkDoc(applied.raw), b).changes).toHaveLength(0);
  });

  it('换读音搬到版本A：写回读音覆盖，复比无改动', () => {
    const a = mkDoc('长城很长。');
    const b = mkDoc('长城很长。', { overrides: { 长: 'zhang3' }, confirmed: ['长'] });
    const r1 = diff(a, b);
    const applied = applyChanges(a, r1.changes, 'forward');
    expect(applied.overrides['长']).toBe('zhang3');
    expect(applied.confirmed).toContain('长');
    const a2 = mkDoc(applied.raw, { overrides: applied.overrides, confirmed: applied.confirmed });
    expect(diff(a2, b).changes).toHaveLength(0);
  });

  it('只挑一部分改动：复比还剩其余改动', () => {
    const a = mkDoc('我们明天去公园。');
    const b = mkDoc('我们明天一起去公园。大家很高兴。');
    const r1 = diff(a, b);
    expect(r1.changes).toHaveLength(2);
    // 只应用「一起」这一处
    const first = r1.changes.find((c) => c.text === '一起')!;
    const applied = applyChanges(a, [first], 'forward');
    expect(applied.raw).toBe('我们明天一起去公园。');
    const r2 = diff(mkDoc(applied.raw), b);
    expect(r2.changes).toHaveLength(1);
    expect(r2.changes[0].text).toBe('大家很高兴。');
  });
});

describe('大文档性能', () => {
  it('约 1 万字、100 段（50 处改写 + 5 段移动）对比 < 3s', () => {
    const paras: string[] = [];
    for (let i = 0; i < 100; i++) {
      paras.push(`第${i}段内容开始，今天我们在这里讨论第${i}个问题，大家都认为这个问题非常重要，需要认真研究解决。`);
    }
    const a = paras.join('\n');
    // 偶数段改写「非常重要→特别重要」；奇数段 1/3/5/7/9 移到末尾（未改写）
    const edited = paras.map((p, i) => (i % 2 === 0 ? p.replace('非常重要', '特别重要') : p));
    const movedIdx = [1, 3, 5, 7, 9];
    const moved = movedIdx.map((i) => edited[i]);
    const rest = edited.filter((_, i) => !movedIdx.includes(i));
    const b = [...rest, ...moved].join('\n');
    const t0 = performance.now();
    const r = diff(mkDoc(a), mkDoc(b));
    const ms = performance.now() - t0;
    expect(r.infos.filter((i) => i.kind === 'moved')).toHaveLength(5);
    expect(r.changes.length).toBe(100); // 50 段 × （删「非常」＋增「特别」）
    expect(ms).toBeLessThan(3000);
  });
});

describe('对不上号时的提示', () => {  it('完全没有共同内容 → 提示根本对不上（真改非错位）', () => {
    const r = diff(mkDoc('今天天气很好。'), mkDoc('ABCDEFGH'));
    expect(r.warnings.some((w) => w.includes('对不上'))).toBe(true);
    expect(r.changes.some((c) => c.kind === 'added')).toBe(true);
    expect(r.changes.some((c) => c.kind === 'deleted')).toBe(true);
  });

  it('内容高度相似但未能对齐 → 提示疑似错位', () => {
    // 一句话挪到了段尾且改写较多（移动配对不成立），删除块与新增块相似度 > 50%
    const r = diff(
      mkDoc('甲。今天天气很好我们出去玩了。乙。'),
      mkDoc('甲。乙。今天天气不错我们在家休息。'),
    );
    expect(r.warnings.some((w) => w.includes('错位'))).toBe(true);
  });

  it('差异过大 → 提示对应率过低', () => {
    const a = mkDoc('今天天气很好我们一起去公园玩。');
    const b = mkDoc('他昨天下雨独自在家睡觉看电视书。');
    const r = diff(a, b);
    expect(r.warnings.some((w) => w.includes('差异过大') || w.includes('对不上'))).toBe(true);
  });
});
