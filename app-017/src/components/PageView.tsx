import type { BrailleCell, PageSetup } from '../types';
import type { LayoutPage } from '../lib/layout';
import BrailleCellView from './BrailleCellView';

interface Props {
  page: LayoutPage;
  setup: PageSetup;
  selected?: { line: number; cell: number } | null;
  onCellClick?: (cell: BrailleCell | null, line: number, index: number) => void;
}

const KIND_NAME: Record<string, string> = {
  hanzi: '汉字',
  letter: '字母',
  digit: '数字',
  punct: '标点',
  prefix: '前置符号',
  space: '空方',
};

/** 单页点阵预览：逐方可点击；页在屏外时浏览器跳过渲染（content-visibility） */
export default function PageView({ page, setup, selected, onCellClick }: Props) {
  return (
    <section className="page" aria-label={`第 ${page.number} 页`}>
      <div className="page-label">
        第 {page.number} 页 · {setup.cellsPerLine} 方 × {setup.linesPerPage} 行
      </div>
      {page.lines.map((line, li) => (
        <div className="line" key={li} role="row" aria-label={`第 ${li + 1} 行`}>
          {line.cells.map((cell, ci) => {
            const isSpace = cell.kind === 'space' && cell.dots.length === 0;
            const isSel = selected?.line === li && selected?.cell === ci;
            const label = `${KIND_NAME[cell.kind] ?? cell.kind}${cell.source ? ` ${cell.source}` : ''}${
              cell.reading ? `（${cell.reading}）` : ''
            }${cell.uncertain ? '，未确认' : ''}`;
            return isSpace ? (
              <span
                className={`slot space-cell${isSel ? ' selected' : ''}`}
                key={ci}
                aria-label="空方"
                onClick={() => onCellClick?.(null, li, ci)}
              />
            ) : (
              <button
                type="button"
                key={ci}
                className={`cell-btn${cell.uncertain ? ' uncertain-cell' : ''}${isSel ? ' selected' : ''}`}
                aria-label={label}
                title={label}
                onClick={() => onCellClick?.(cell, li, ci)}
              >
                <BrailleCellView dots={cell.dots} />
              </button>
            );
          })}
          {/* 补齐行宽网格 */}
          {Array.from({ length: Math.max(0, setup.cellsPerLine - line.cells.length) }, (_, k) => (
            <span className="slot" key={`pad-${k}`} aria-hidden="true" />
          ))}
        </div>
      ))}
    </section>
  );
}
