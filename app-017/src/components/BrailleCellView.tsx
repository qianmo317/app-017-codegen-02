/** 单方盲文点阵（SVG，mm 比例：方宽6.2、行高10、点距2.5、点径1.5） */
const DOT_OFFSET: Record<number, [number, number]> = {
  1: [0, 0],
  4: [1, 0],
  2: [0, 1],
  5: [1, 1],
  3: [0, 2],
  6: [1, 2],
};

const X0 = 1.85;
const Y0 = 2.5;
const PITCH = 2.5;
const R = 0.75;

export default function BrailleCellView({ dots }: { dots: number[] }) {
  return (
    <svg
      className="cell-svg"
      viewBox="0 0 6.2 10"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {dots.map((d) => {
        const [ox, oy] = DOT_OFFSET[d] ?? [0, 0];
        return <circle key={d} cx={X0 + ox * PITCH} cy={Y0 + oy * PITCH} r={R} fill="currentColor" />;
      })}
    </svg>
  );
}
