// A wallet's avatar: a 5×5 mirrored pattern drawn from its address, in MINTA's cyan on a dark tile, so the same wallet
// always looks the same. Decoration only: the address itself is what identifies a wallet.
import { useMemo } from 'react';

export default function Avatar({ address, size = 28 }: { address: string; size?: number }) {
  const cells = useMemo(() => {
    const h = address.toLowerCase().replace(/^0x/, '');
    const on: [number, number][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
      if (parseInt(h[(y * 3 + x) % h.length], 16) % 2) { on.push([x, y]); if (x < 2) on.push([4 - x, y]); }
    }
    const hue = parseInt(h.slice(-2), 16) % 3; // three cyan shades
    return { on, fill: ['#26f0f2', '#19c4c4', '#7ff8f9'][hue] };
  }, [address]);
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 5 5" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="5" height="5" fill="#161a10" />
      {cells.on.map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={cells.fill} />)}
    </svg>
  );
}
