// A token's recent price as a small line, oldest on the left: cyan when it's up, coral when it's down. Its figure
// (the 24-hour change, with its sign) sits beside it in text, so the color is never the only cue. `fluid` stretches it
// to its box's width.
export default function Spark({ points, up, width = 88, height = 28, fluid = false }: { points: number[]; up: boolean; width?: number; height?: number; fluid?: boolean }) {
  const size = fluid ? { width: '100%', height, preserveAspectRatio: 'none' } : { width, height };
  if (points.length < 2) return <svg className="spark" {...size} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><line x1="2" x2={width - 2} y1={height / 2} y2={height / 2} className="flat" vectorEffect="non-scaling-stroke" /></svg>;
  let lo = Math.min(...points), hi = Math.max(...points);
  if (hi - lo <= hi * 1e-9) { lo = hi * 0.95; hi *= 1.05; }
  const x = (i: number) => 2 + (i / (points.length - 1)) * (width - 4);
  const y = (p: number) => 2 + (1 - (p - lo) / (hi - lo)) * (height - 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg className={`spark ${up ? 'up' : 'down'}`} {...size} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
