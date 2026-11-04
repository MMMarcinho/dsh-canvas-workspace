/** The four-panel Canvas glyph shared by the native sidebar and the canvas panel. */
export function CanvasIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="14" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="2" />
      <path d="M7 14v4a1 1 0 0 0 1 1h2M16 10v1" />
    </svg>
  );
}
