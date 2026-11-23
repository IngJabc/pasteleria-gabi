import type { CSSProperties, ReactNode } from "react";
import { Card, Chip } from "@/components/ui/ui";

/** Page heading, optional supporting copy and an optional action slot. */
export function AdminPageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-extrabold text-plum sm:text-4xl">
          {title}
        </h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

const statToneClass = {
  pink: "border-pink-soft bg-rose",
  lavender: "border-lavender bg-lavender/60",
  mint: "border-mint bg-mint/60",
  yellow: "border-yellow bg-yellow/60",
} as const;

/** Compact KPI tile. Values are supplied by the caller's real queries. */
export function AdminStatCard({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  tone: keyof typeof statToneClass;
}) {
  return (
    <div className={`rounded-card border p-5 ${statToneClass[tone]}`}>
      <p className="text-eyebrow">{label}</p>
      <p className="mt-3 font-display text-3xl font-extrabold text-plum">
        {value}
      </p>
      {caption ? <p className="mt-2 text-sm text-muted">{caption}</p> : null}
    </div>
  );
}

/** White rounded surface for a card section. */
export function AdminSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`border border-rose/60 ${className}`.trim()}>{children}</Card>
  );
}

const bannerToneClass = {
  yellow: "border-yellow bg-yellow/60",
  lavender: "border-lavender bg-lavender/60",
  pink: "border-pink-soft bg-rose",
} as const;

/** Informational banner. Callers supply truthful, server-derived messages. */
export function AdminBanner({
  children,
  tone,
}: {
  children: ReactNode;
  tone: keyof typeof bannerToneClass;
}) {
  return (
    <div className={`rounded-card border px-5 py-4 text-ink ${bannerToneClass[tone]}`}>
      {children}
    </div>
  );
}

/** Pastel status chip for tables and detail views. */
export function AdminStatusChip({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "yellow" | "mint" | "lavender" | "rose";
}) {
  return <Chip tone={tone}>{children}</Chip>;
}

/** Honest empty state for missing business data or unsupported capabilities. */
export function AdminEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-lavender bg-cream px-6 py-10 text-center">
      <h3 className="font-display text-xl font-extrabold text-plum">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        {description}
      </p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Semantic data table in a labeled, keyboard-scrollable region.
 *
 * `headers` names the columns and are reused as injected labels in the stacked
 * mobile layout provided by globals.css. Cell markup is supplied by callers.
 */
export function AdminTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}) {
  const labelStyle: CSSProperties = {};
  const labelRecord = labelStyle as Record<string, string>;
  headers.forEach((header, index) => {
    labelRecord[`--admin-col-${index + 1}`] = JSON.stringify(header);
  });

  return (
    <div className="admin-table-container">
      <div
        className="admin-table-scroll"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className="admin-table" style={labelStyle}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={`${header}-${index}`}
                  scope="col"
                  className="text-xs font-bold uppercase tracking-widest text-muted"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Heading for a section inside an AdminSurface. */
export function AdminSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-xl font-extrabold text-plum">{children}</h2>
  );
}
