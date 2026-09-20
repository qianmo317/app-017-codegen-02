/**
 * BRF（Braille ASCII / .brf）输出与校验。
 * 规范（需求文档 §8）：每方一个 ASCII 字符；行尾不留多余空格（打字机会输出多余的空白方）；
 * 页尾插入换页符 \f。
 */
import { BRF_CHAR_TO_DOTS, dotsToBrf } from './dots';
import type { LayoutPage } from './layout';

/** 行 cells → BRF 字符串（去除行尾空格） */
export function lineToBRF(cells: { dots: number[] }[]): string {
  return cells
    .map((c) => dotsToBrf(c.dots))
    .join('')
    .replace(/[ ]+$/, '');
}

/** 页序列 → BRF 文本（每行以 \n 结尾，每页以换页符 \f 结尾） */
export function pagesToBRF(pages: LayoutPage[]): string {
  let out = '';
  for (const page of pages) {
    for (const line of page.lines) {
      out += lineToBRF(line.cells) + '\n';
    }
    out += '\f\n';
  }
  return out;
}

export interface BRFValidation {
  ok: boolean;
  issues: string[];
  pageBlocks: string[][];
}

/**
 * BRF 结构校验（供测试脚本与 UI 使用）：
 * - 字符集必须是标准 Braille ASCII（0x20-0x5F）+ \n + \f；
 * - 每行长度 ≤ 行宽；行尾无空格；
 * - 每页（\f 分隔）行数 ≤ linesPerPage。
 */
export function validateBRF(text: string, cellsPerLine: number, linesPerPage: number): BRFValidation {
  const issues: string[] = [];
  const validChars = new Set(Object.keys(BRF_CHAR_TO_DOTS));

  const rawBlocks = text.split('\f\n'); // 页终止符是 \f\n（换页符后的换行属于页尾，不属于下一页）
  // 末尾应是 \f\n → 最后一块为空或仅剩换行
  const blocks = rawBlocks.filter((b, idx) => !(idx === rawBlocks.length - 1 && b.trim() === ''));
  if (rawBlocks.length > 1 && (rawBlocks[rawBlocks.length - 1].trim() !== '' || !text.endsWith('\f\n'))) {
    issues.push('文件应以换页符 \\f\\n 结尾');
  }

  const pageBlocks: string[][] = [];
  blocks.forEach((block, pi) => {
    const lines = block.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    pageBlocks.push(lines);
    if (lines.length > linesPerPage) {
      issues.push(`第 ${pi + 1} 页有 ${lines.length} 行，超过每页上限 ${linesPerPage}`);
    }
    lines.forEach((line, li) => {
      if (/[ ]$/.test(line)) issues.push(`第 ${pi + 1} 页第 ${li + 1} 行行尾有空格`);
      if (line.length > cellsPerLine) {
        issues.push(`第 ${pi + 1} 页第 ${li + 1} 行宽 ${line.length} 超过 ${cellsPerLine}`);
      }
      for (const ch of line) {
        if (!validChars.has(ch)) issues.push(`第 ${pi + 1} 页第 ${li + 1} 行含非法字符 U+${ch.codePointAt(0)?.toString(16)}`);
      }
    });
  });

  return { ok: issues.length === 0, issues, pageBlocks };
}
