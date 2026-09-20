/**
 * 性能测试（需求文档 §10）：1 万字文档转换 < 300ms；多页排版流畅。
 */
import { describe, expect, it } from 'vitest';
import { convertText } from '../src/lib/convert';
import { layoutDocument } from '../src/lib/layout';
import { pagesToBRF } from '../src/lib/brf';

const OPTS = { toneMode: 'national' as const, autoDetectPinyin: true, profile: 'zh-current' as const };
const SETUP = { cellsPerLine: 32, linesPerPage: 25, doubleSided: false, marginMm: { top: 20, left: 15, right: 15 } };

function makeText(chars: number): string {
  const sentence = '盲文排版是把文字转成凸点符号的过程，特殊教育学校需要大量点字教材，包括语文、数学和英语课本。';
  const repeated = sentence.repeat(Math.ceil(chars / sentence.length));
  return repeated.slice(0, chars);
}

describe('性能', () => {
  it('1 万字转换 < 300ms', () => {
    const text = makeText(10000);
    expect([...text].length).toBe(10000);
    convertText(text.slice(0, 500), OPTS); // 预热（词典/索引加载）
    const t0 = performance.now();
    const r = convertText(text, OPTS);
    const ms = performance.now() - t0;
    console.log(`1万字转换耗时 ${ms.toFixed(1)}ms，产出 ${r.stats.cellCount} 方`);
    expect(ms).toBeLessThan(300);
    expect(r.stats.hanziCount).toBeGreaterThan(9000);
  });

  it('1 万字分页排版（含页码）< 200ms', () => {
    const text = makeText(10000);
    const conv = convertText(text, OPTS);
    const t0 = performance.now();
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    const ms = performance.now() - t0;
    console.log(`1万字分页耗时 ${ms.toFixed(1)}ms，${layout.pages.length} 页`);
    expect(ms).toBeLessThan(200);
  });

  it('100 页 BRF 生成 < 100ms', () => {
    const text = makeText(45000);
    const conv = convertText(text, OPTS);
    const layout = layoutDocument(conv.paragraphs, SETUP, true);
    expect(layout.pages.length).toBeGreaterThan(100);
    const t0 = performance.now();
    const brf = pagesToBRF(layout.pages);
    const ms = performance.now() - t0;
    console.log(`${layout.pages.length} 页 BRF 生成 ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(100);
    expect(brf.length).toBeGreaterThan(10000);
  });
});
