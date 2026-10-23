import type { ReactNode } from "react";
export type IconName =
  | "note"
  | "task"
  | "agent"
  | "artifact"
  | "cursor"
  | "plus"
  | "minus"
  | "fit"
  | "arrow"
  | "close"
  | "download"
  | "upload"
  | "check"
  | "copy"
  | "stop"
  | "link"
  | "trash"
  | "edit"
  | "grid"
  | "home"
  | "help"
  | "user"
  | "arrow-up";
const paths: Record<IconName, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  "arrow-up": <path d="M12 19V5m-6 6 6-6 6 6" />,
  note: (
    <>
      <path d="M5 3h10l4 4v14H5z" />
      <path d="M14 3v5h5M8 12h8M8 16h6" />
    </>
  ),
  task: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="7" width="16" height="13" rx="5" />
      <path d="M12 3v4M9 13h.01M15 13h.01M9 17h6M2 12v4M22 12v4" />
    </>
  ),
  artifact: (
    <>
      <path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  cursor: <path d="m5 3 14 10-7 1-3 7z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: (
    <>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </>
  ),
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />,
  check: <path d="m5 12 4 4L19 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  link: (
    <>
      <path
        d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
        transform="translate(1 1) scale(.9)"
      />
    </>
  ),
  trash: <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />,
  edit: <path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4" />,
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  home: <path d="m3 10 9-7 9 7M5 9v12h14V9M10 21v-7h4v7" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01" />
    </>
  ),
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
