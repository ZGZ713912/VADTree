import type { CSSProperties, ReactNode } from "react";

type IconProps = { size?: number; className?: string; style?: CSSProperties };

function Svg({ size = 16, className, style, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function MarkIcon({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M10 17V4" />
      <path d="M10 10 4 5" />
      <path d="M10 12 16 7" />
      <circle cx="4" cy="5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="16" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="3" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function DeskIcon(props: IconProps) {
  return <Svg {...props}><path d="M3 5h14v10H3z" /><path d="M3 9h14M6 12h3" /></Svg>;
}

export function RunsIcon(props: IconProps) {
  return <Svg {...props}><path d="M3 4h14M3 10h14M3 16h9" /><circle cx="16" cy="16" r="1.4" /></Svg>;
}

export function EvidenceIcon(props: IconProps) {
  return <Svg {...props}><path d="M4 3v14M4 5h7l2 2h3v10H4" /><path d="M7 10h6M7 13h4" /></Svg>;
}

export function PipelineIcon(props: IconProps) {
  return <Svg {...props}><circle cx="5" cy="5" r="1.5" /><circle cx="15" cy="10" r="1.5" /><circle cx="5" cy="15" r="1.5" /><path d="M6.5 5H10v5h3.5M10 10v-5" /></Svg>;
}

export function ArchiveIcon(props: IconProps) {
  return <Svg {...props}><path d="M3 4h14v4H3zM4 8v8h12V8M8 11h4" /></Svg>;
}

export function SearchIcon(props: IconProps) {
  return <Svg {...props}><circle cx="9" cy="9" r="5" /><path d="m13 13 4 4" /></Svg>;
}

export function ArrowIcon(props: IconProps) {
  return <Svg {...props}><path d="M4 16 16 4M7 4h9v9" /></Svg>;
}

export function ChevronIcon({ direction = "right", ...props }: IconProps & { direction?: "right" | "down" | "left" }) {
  const d = direction === "down" ? "m5 8 5 5 5-5" : direction === "left" ? "m12 5-5 5 5 5" : "m8 5 5 5-5 5";
  return <Svg {...props}><path d={d} /></Svg>;
}

export function CloseIcon(props: IconProps) {
  return <Svg {...props}><path d="m5 5 10 10M15 5 5 15" /></Svg>;
}

export function PlayIcon(props: IconProps) {
  return <Svg {...props}><path d="M7 5v10l8-5z" /></Svg>;
}

export function StopIcon(props: IconProps) {
  return <Svg {...props}><rect x="6" y="6" width="8" height="8" /></Svg>;
}

export function CheckIcon(props: IconProps) {
  return <Svg {...props}><path d="m4 10 4 4 8-9" /></Svg>;
}

export function WarnIcon(props: IconProps) {
  return <Svg {...props}><path d="M10 3 2.5 17h15z" /><path d="M10 8v4M10 14.5v.2" /></Svg>;
}

export function BlockIcon(props: IconProps) {
  return <Svg {...props}><circle cx="10" cy="10" r="7" /><path d="m5 5 10 10" /></Svg>;
}
