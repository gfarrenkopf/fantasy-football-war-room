/** The season page's few icons: one 24px grid, 2px round strokes, currentColor. Decorative unless labelled. */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const ArrowRight = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Check = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const Lock = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const Refresh = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  </svg>
);

export const External = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
  </svg>
);

export const Swap = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />
  </svg>
);
