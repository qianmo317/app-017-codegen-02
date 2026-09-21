import type { BrailleCell, PageSetup } from '../types';
import type { LayoutPage } from '../lib/layout';
import type { CellPos } from '../lib/diff';
import BrailleCellView from './BrailleCellView';

export type DiffHighlight = 'added' | 'removed' | 'reading' | 'suspicious';

interface Props {
  page: LayoutPage;
  setup: PageSetup;
  selected?: { line: number; cell: number } | null;
  onCellClick?: (cell: BrailleCell | null, line: number, index: number) => void;
  /** 方对象 → 高亮类别（按对象身份匹配；缩进/页码等注入方不在其中，自然不高亮） */
  highlights?: Map<BrailleCell, DiffHighlight>;
  /** 跳转定位：滚动到并聚焦该 页/行/方 */
  focusPos?: CellPos | null;
}

const KIND_NAME: Record<string, string> = {
  hanzi: '汉字',
  letter: '字母',
  digit: '数字',
  punct: '标点',
  prefix: '前置符号',
  space: '空方',
};

const HL_LABEL: Record<DiffHighlight, string> = {
  added: '新加',
  removed: '删除',
  reading: '换读音',
  suspicious: '疑似错位',
};

/** 单页点阵预览：逐方可点击；页在屏外时浏览器跳过渲染（content-visibility） */
export default function PageView({ page, setup, selected, onCellClick, highlights, focusPos }: Props) {
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
            const hl = highlights?.get(cell);
            const isFocus = focusPos?.page === page.number && focusPos?.line === li + 1 && focusPos?.cell === ci + 1;
            const hlClass = hl ? ` hl-${hl}` : '';
            const hlText = hl ? `，${HL_LABEL[hl]}` : '';
            const label = `${KIND_NAME[cell.kind] ?? cell.kind}${cell.source ? ` ${cell.source}` : ''}${
              cell.reading ? `（${cell.reading}）` : ''
            }${cell.uncertain ? '，未确认' : ''}${hlText}`;
            return isSpace ? (
              <span
                className={`slot space-cell${isSel ? ' selected' : ''}${hlClass}${isFocus ? ' focus-here' : ''}`}
                key={ci}
                aria-label={hl ? `空方，${HL_LABEL[hl]}` : '空方'}
                onClick={() => onCellClick?.(null, li, ci)}
              />
            ) : (
              <button
                type="button"
                key={ci}
                className={`cell-btn${cell.uncertain ? ' uncertain-cell' : ''}${isSel ? ' selected' : ''}${hlClass}${
                  isFocus ? ' focus-here' : ''
                }`}
                aria-label={label}
                title={label}
                data-hl={hl}
                ref={isFocus ? focusIntoView : undefined}
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

/** 跳转目标自动滚动进视口并聚焦（键盘流可达） */
function focusIntoView(el: HTMLButtonElement | null) {
  if (el) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }
}
