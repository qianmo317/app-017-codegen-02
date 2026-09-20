/**
 * 分页排版：段落 → 行 → 页。
 * 规则（需求文档 §4.3 / §8）：
 * - 页面 32方 × 25行（可自定义）；
 * - 词不跨行（只在词边界换行），数字/字母串不可分割；
 * - 段首缩进 2 方；空行分段；页码（盲文数字）位于每页第一行右端；
 * - 超过整行宽度的词强制拆分并标记违规，绝不静默。
 */
import digitsJson from '../rules/zh-digits.json';
import type { BrailleCell, PageSetup } from '../types';
import type { ParagraphResult } from './convert';

export interface LayoutLine {
  cells: BrailleCell[];
}

export interface LayoutPage {
  number: number;
  lines: LayoutLine[];
}

export interface LayoutViolation {
  type: 'word-too-long';
  word: string;
  cells: number;
}

export interface LayoutResult {
  pages: LayoutPage[];
  violations: LayoutViolation[];
}

const PARAGRAPH_INDENT = 2;
const DIGITS = digitsJson.digits as Record<string, string>;
const NUMBER_SIGN = digitsJson.numberSign;
const NUMBER_SIGN_DOTS = NUMBER_SIGN.split('').map(Number);

const SPACE_CELL: BrailleCell = { dots: [], kind: 'space' };
const INDENT_CELLS: BrailleCell[] = Array.from({ length: PARAGRAPH_INDENT }, () => ({ ...SPACE_CELL }));

interface Group {
  cells: BrailleCell[];
  word: string;
  /** 组首段落缩进的方数（不计入违规词宽统计） */
  indent?: number;
}

/** 词序列 → 不可拆分组：标点并入前词（标点前不空方），其余词独立成组 */
function buildGroups(paragraph: ParagraphResult): Group[] {
  const groups: Group[] = [];
  for (const w of paragraph.words) {
    if (w.cells.length === 0) continue;
    const isPunctRun = w.cells.length > 0 && w.cells.every((c) => c.kind === 'punct');
    if (isPunctRun && groups.length > 0) {
      groups[groups.length - 1].cells.push(...w.cells);
    } else {
      groups.push({ cells: [...w.cells], word: w.source });
    }
  }
  return groups;
}

class LineWriter {
  cur: BrailleCell[] = [];
  lines: BrailleCell[][] = [];

  constructor(private width: number) {}

  newline() {
    this.lines.push(this.cur);
    this.cur = [];
  }

  /** 写入一个不可拆分组；超行宽时强制拆分并记录违规 */
  write(g: Group, violations: LayoutViolation[]) {
    if (g.cells.length > this.width) {
      violations.push({ type: 'word-too-long', word: g.word, cells: g.cells.length - (g.indent ?? 0) });
      if (this.cur.length) this.newline();
      for (let i = 0; i < g.cells.length; i += this.width) {
        this.lines.push(g.cells.slice(i, i + this.width));
      }
      return;
    }
    if (this.cur.length > 0 && this.cur.length + 1 + g.cells.length > this.width) {
      this.newline();
    }
    if (this.cur.length > 0) this.cur.push({ ...SPACE_CELL });
    this.cur.push(...g.cells);
  }

  finish() {
    if (this.cur.length > 0 || this.lines.length === 0) this.newline();
  }

  /** 段落边界：当前行未满也强制换行 */
  breakBefore() {
    if (this.cur.length > 0) this.newline();
  }
}

/** 盲文页码行：数符 + 数字方，右对齐（页码独占每页第一行） */
function pageNumberLine(n: number, width: number): LayoutLine {
  const cells: BrailleCell[] = [{ dots: [...NUMBER_SIGN_DOTS], kind: 'prefix', source: String(n) }];
  for (const ch of String(n)) {
    const d = DIGITS[ch];
    cells.push({ dots: d.split('').map(Number), kind: 'digit', source: ch });
  }
  const pad = Math.max(0, width - cells.length);
  const line: BrailleCell[] = Array.from({ length: pad }, () => ({ ...SPACE_CELL }));
  line.push(...cells);
  return { cells: line };
}

/** 段落序列 → 分页排版结果 */
export function layoutDocument(
  paragraphs: ParagraphResult[],
  setup: PageSetup,
  showPageNumbers: boolean,
): LayoutResult {
  const writer = new LineWriter(setup.cellsPerLine);
  const violations: LayoutViolation[] = [];

  for (const p of paragraphs) {
    writer.breakBefore();
    if (p.blank) {
      writer.lines.push([]);
      continue;
    }
    const groups = buildGroups(p);
    if (groups.length === 0) {
      writer.lines.push([]);
      continue;
    }
    groups[0] = { word: groups[0].word, indent: PARAGRAPH_INDENT, cells: [...INDENT_CELLS, ...groups[0].cells] };
    for (const g of groups) writer.write(g, violations);
  }
  writer.finish();

  const contentLines = writer.lines.length > 0 ? writer.lines : [[]];
  const pages: LayoutPage[] = [];
  const contentPerPage = showPageNumbers ? Math.max(1, setup.linesPerPage - 1) : setup.linesPerPage;

  let pageNum = 1;
  let i = 0;
  while (i < contentLines.length) {
    const chunk = contentLines.slice(i, i + contentPerPage);
    const page: LayoutPage = { number: pageNum, lines: [] };
    if (showPageNumbers) page.lines.push(pageNumberLine(pageNum, setup.cellsPerLine));
    for (const l of chunk) page.lines.push({ cells: l });
    pages.push(page);
    i += chunk.length;
    pageNum++;
  }
  return { pages, violations };
}
