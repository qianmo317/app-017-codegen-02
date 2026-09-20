/**
 * BRF 结构校验（npm run check:brf）：可被盲文打字机读取的 BRF 必须满足：
 * 字符集合法、行宽 ≤ 上限、行尾无空格、每页行数 ≤ 上限、页尾换页符。
 */
import { describe, expect, it } from 'vitest';
import { convertText } from '../src/lib/convert';
import { layoutDocument } from '../src/lib/layout';
import { pagesToBRF, validateBRF, lineToBRF } from '../src/lib/brf';

const OPTS = { toneMode: 'national' as const, autoDetectPinyin: true, profile: 'zh-current' as const };
const SETUP = { cellsPerLine: 32, linesPerPage: 25, doubleSided: false, marginMm: { top: 20, left: 15, right: 15 } };

const SAMPLE = `特殊教育学校通知

各位家长：本校定于下周五下午两点召开家长会，请准时参加。
联系电话：010-66889900，地点：教学楼201室。

特教学校教务处
2026年9月20日`;

describe('BRF 生成与校验', () => {
  it('样例文档生成的 BRF 通过全部结构校验', () => {
    const conv = convertText(SAMPLE, OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    const brf = pagesToBRF(layout.pages);
    const v = validateBRF(brf, SETUP.cellsPerLine, SETUP.linesPerPage);
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
    expect(brf.endsWith('\f\n')).toBe(true);
    // 每页以 \f 分隔
    expect(brf.split('\f').length - 1).toBe(layout.pages.length);
  });

  it('100 页长文 BRF 仍通过校验', () => {
    const text = Array.from(
      { length: 120 },
      (_, i) => `第${i + 1}课：${'盲文排版与打印要点说明。'.repeat(30)}`,
    ).join('\n');
    const conv = convertText(text, OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    expect(layout.pages.length).toBeGreaterThan(100);
    const v = validateBRF(pagesToBRF(layout.pages), SETUP.cellsPerLine, SETUP.linesPerPage);
    expect(v.issues).toEqual([]);
  });

  it('检测行尾空格', () => {
    const v = validateBRF('abc \nabc\f\n', 32, 25);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('行尾有空格'))).toBe(true);
  });

  it('检测行宽超限', () => {
    const v = validateBRF('a'.repeat(40) + '\f\n', 32, 25);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('超过 32'))).toBe(true);
  });

  it('检测非法字符', () => {
    const v = validateBRF('aéz\f\n', 32, 25);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('非法字符'))).toBe(true);
  });

  it('检测页行数超限', () => {
    const lines = Array.from({ length: 26 }, (_, i) => `page${i}`).join('\n');
    const v = validateBRF(lines + '\f\n', 32, 25);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.includes('超过每页上限'))).toBe(true);
  });

  it('lineToBRF 行尾无空格', () => {
    expect(lineToBRF([{ dots: [1] }, { dots: [] }, { dots: [] }])).toBe('a');
  });
});
