type Props = { userId: string; size: number; src?: string | null };

export function AccountAvatar({ userId, size, src }: Props) {
  const style = { width: size, height: size, borderRadius: "50%", border: "1px solid var(--af-color-border)", display: "block" };
  if (src) return <img src={src} alt="" style={{ ...style, objectFit: "cover" }} />;

  // A stable, mirrored five-column identicon for accounts without a picture.
  let seed = 5381;
  for (const char of userId) seed = (Math.imul(seed, 33) ^ char.charCodeAt(0)) >>> 0;
  const pixels = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      const bit = y * 3 + Math.min(x, 4 - x);
      if ((seed >>> bit) & 1) pixels.push(<rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" />);
    }
  }
  return (
    <svg viewBox="0 0 7 7" aria-hidden="true" style={style}>
      <rect width="7" height="7" fill="#f0f2f4" />
      <g fill={`hsl(${seed % 360} 42% 54%)`}>{pixels}</g>
    </svg>
  );
}
