/**
 * The toolbar's inline SVGs — Lucide v1.47.0 (ISC), vendored exactly as the
 * reference `index.html` vendors them. Artwork unchanged; sizing comes from
 * `.icon`, colour from currentColor.
 */

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function FilterIcon() {
  return (
    <svg className="icon lucide-filter" viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg className="icon lucide-download" viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function UploadIcon() {
  return (
    <svg className="icon lucide-upload" viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m17 8-5-5-5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

export function SlidersIcon() {
  return (
    <svg className="icon lucide-sliders-horizontal" viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M10 5H3" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M16 17v4" />
      <path d="M21 12h-9" />
      <path d="M21 19h-5" />
      <path d="M21 5h-7" />
      <path d="M8 10v4" />
      <path d="M8 12H3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="icon lucide-trash-2" viewBox="0 0 24 24" {...strokeProps} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function ChevIcon() {
  return (
    <svg className="chev" viewBox="0 0 10 6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}
