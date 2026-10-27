import type { CSSProperties } from 'react';

// Dotted background: a quiet, still grid of dots over the theme color.
// Intensity scales how visible the dots are.
export function Dots({ intensity }: { intensity: number }) {
  const style = { '--k': (intensity / 100).toFixed(2) } as CSSProperties;
  return (
    <div aria-hidden="true" className="dots" style={style}>
      <div className="dots-base" />
    </div>
  );
}
