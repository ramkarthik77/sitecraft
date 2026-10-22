import type { CSSProperties } from "react";

/** Small stroke icons drawn on a 16px grid. Decorative unless given a label. */
const PATHS: Record<string, string> = {
  desktop: "M2 3.5h12v8H2z M6 14h4",
  tablet: "M3.5 2h9v12h-9z M7 12h2",
  phone: "M5 1.5h6v13H5z M7.2 12.5h1.6",
  undo: "M5.5 4 2.5 7l3 3 M3 7h7a3.5 3.5 0 0 1 0 7H8",
  redo: "M10.5 4l3 3-3 3 M13 7H6a3.5 3.5 0 0 0 0 7h2",
  check: "M3 8.5 6.5 12 13 4.5",
  chevron: "M4.5 6 8 9.5 11.5 6",
  back: "M10 3.5 5.5 8l4.5 4.5",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z M10.6 10.6 14 14",
  plus: "M8 3v10 M3 8h10",
  layers: "M8 2 2 5.5 8 9l6-3.5Z M2 9.5 8 13l6-3.5",
  insert: "M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z M11.25 9v4.5 M9 11.25h4.5",
  pages: "M4 1.5h5.5L12.5 4.5v10H4z M9.5 1.5v3h3",
  history: "M8 14A6 6 0 1 0 2 8 M2 8l-1-1.5M2 8l1.5-1 M8 4.5V8l2.5 1.5",
  settings: "M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  external: "M9.5 2.5h4v4 M13.5 2.5 7.5 8.5 M11.5 9.5v4h-9v-9h4",
  branch: "M4.5 2.5v11 M4.5 13.5a1.8 1.8 0 1 0 0-.01 M11.5 5.5a1.8 1.8 0 1 0 0-.01 M11.5 7.3c0 2.5-2.5 3-7 3.7",
  copy: "M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3",
  trash: "M2.5 4h11 M6 4V2.5h4V4 M4 4l.7 9.5h6.6L12 4",
  close: "M4 4l8 8 M12 4l-8 8",
  grid: "M2.5 2.5h4.5v4.5H2.5z M9 2.5h4.5v4.5H9z M2.5 9h4.5v4.5H2.5z M9 9h4.5v4.5H9z",
  review: "M4.5 2.5v11 M4.5 13.5a1.8 1.8 0 1 0 0-.01 M11.5 5.5a1.8 1.8 0 1 0 0-.01 M11.5 7.3c0 2.5-2.5 3-7 3.7",
  inbox: "M2 9.5 3.8 3h8.4L14 9.5v4H2z M2 9.5h3.5l1 1.5h3l1-1.5H14",
  terminal: "M2 2.5h12v11H2z M4.5 6l2 2-2 2 M8 10.5h3.5",
  spark: "M8 1.5v13 M1.5 8h13 M3.4 3.4l9.2 9.2 M12.6 3.4l-9.2 9.2",
  logout: "M6 2.5H2.5v11H6 M10 5l3 3-3 3 M13 8H6",
  download: "M8 2.5v8 M4.5 7.5 8 11l3.5-3.5 M2.5 13.5h11",
};

export function Icon({ name, size = 16, label, style }: { name: keyof typeof PATHS | string; size?: number; label?: string; style?: CSSProperties }) {
  const d = PATHS[name] ?? "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      style={{ flex: "none", ...style }}
    >
      <path d={d} />
    </svg>
  );
}

/** Sitecraft mark. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" style={{ flex: "none" }}>
      <rect width="26" height="26" rx="7" fill="#E6E8EB" />
      <path d="M7 17.5 13 7l6 10.5Z" fill="#111317" />
      <circle cx="13" cy="15" r="2.2" fill="#5B8CFF" />
    </svg>
  );
}
