// Shared skeleton placeholders. Each matches the post-load layout shape so the
// page doesn't jump when data arrives. Uses Tailwind's animate-pulse over a
// flat rgba block; no shimmer libs needed.

import { type CSSProperties } from "react";

const CARD: CSSProperties = { background: "rgba(20,20,28,0.55)" };

function Block({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`bg-white/[0.06] rounded ${className}`} style={style} />;
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl p-6 border border-white/[0.06] animate-pulse"
      style={CARD}
    >
      {children}
    </section>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-white/50">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="animate-spin"
        aria-hidden
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" fill="none" />
        <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
      {label}
    </span>
  );
}

function BarRow() {
  return (
    <div className="flex items-center gap-3">
      <Block className="h-3 w-28 shrink-0" />
      <Block className="h-2 flex-1" style={{ width: `${30 + Math.random() * 60}%` }} />
      <Block className="h-3 w-12 shrink-0" />
    </div>
  );
}

function LeaderboardSection({ rowCount = 5, title = true }: { rowCount?: number; title?: boolean }) {
  return (
    <SectionCard>
      {title && (
        <div className="flex items-baseline justify-between mb-5">
          <Block className="h-4 w-40" />
          <Block className="h-3 w-32" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: rowCount }, (_, i) => <BarRow key={i} />)}
      </div>
    </SectionCard>
  );
}

export function SkeletonLeaderboard() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap animate-pulse">
        <Block className="h-7 w-44" />
        <Block className="h-4 w-48" />
      </div>
      <LeaderboardSection rowCount={4} />
      <LeaderboardSection rowCount={5} />
      <LeaderboardSection rowCount={3} />
      <LeaderboardSection rowCount={4} />
    </div>
  );
}

export function SkeletonHistory() {
  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-3 animate-pulse">
        <Block className="h-4 w-32" />
        <Block className="h-3 w-40" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <SectionCard key={i}>
          <div className="flex items-baseline justify-between mb-4">
            <Block className="h-4 w-56" />
            <Block className="h-3 w-24" />
          </div>
          <Block className="h-40 w-full" />
        </SectionCard>
      ))}
    </div>
  );
}

export function SkeletonOutputEvolution() {
  return (
    <SectionCard>
      <div className="flex items-baseline justify-between mb-4">
        <Block className="h-4 w-72" />
        <Block className="h-3 w-40" />
      </div>
      <div className="space-y-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Block className="h-3 w-48" />
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 8 }, (_, j) => (
                <Block key={j} className="h-20 w-20 shrink-0" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function SkeletonOperator() {
  return (
    <div className="rounded-xl p-3 border border-white/[0.06] flex items-center gap-3 animate-pulse" style={CARD}>
      <Block className="h-3 w-24" />
      <Block className="h-3 w-32" />
      <Block className="h-3 w-20" />
      <Block className="h-3 w-16" />
    </div>
  );
}
