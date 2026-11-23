import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

/**
 * Shared visual primitives for the Dulce Atelier design system.
 *
 * Keeping the class strings in one module guarantees the storefront and the
 * admin panel stay visually consistent and makes the sampled tokens easy to
 * audit in one place.
 */

export const containerClass = "container-page";

export const buttonPrimaryClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-white bg-pink-soft px-6 py-2 font-display text-base font-bold text-ink shadow-sticker transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

export const buttonSecondaryClass =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border-[3px] border-white bg-lavender px-6 py-2 font-display text-base font-bold text-ink shadow-sticker-secondary transition-all hover:brightness-[0.98] active:translate-y-[2px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-60";

export const buttonGhostClass =
  "inline-flex min-h-11 cursor-pointer items-center gap-1 font-display text-base font-bold text-pink underline-offset-4 transition-all hover:underline active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-60";

export const inputClass =
  "min-h-12 w-full rounded-field border border-rose bg-white px-4 py-2 text-base text-ink shadow-sm transition-colors placeholder:text-muted/70 hover:border-lavender focus-visible:border-lavender focus-visible:outline-none aria-invalid:border-pink aria-invalid:bg-rose/40";

export const textareaClass = `${inputClass} min-h-28 resize-y`;

export const labelClass =
  "mb-2 block font-display text-sm font-bold text-ink";

export const hintClass = "mt-2 text-sm text-muted";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: buttonPrimaryClass,
  secondary: buttonSecondaryClass,
  ghost: buttonGhostClass,
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${variantClass[variant]} ${className}`.trim()}
      {...props}
    />
  );
}

export function Field({
  id,
  label,
  hint,
  children,
  className = "",
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint ? <p className={hintClass}>{hint}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input className={`${inputClass} ${className}`.trim()} {...rest} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea className={`${textareaClass} ${className}`.trim()} {...rest} />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-card bg-white p-6 shadow-sm ${className}`.trim()}>
      {children}
    </div>
  );
}

const chipToneClass: Record<string, string> = {
  yellow: "bg-yellow text-ink",
  mint: "bg-mint text-ink",
  lavender: "bg-lavender text-ink",
  rose: "bg-rose text-ink",
};

export function Chip({
  tone = "lavender",
  children,
}: {
  tone?: keyof typeof chipToneClass;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${chipToneClass[tone]}`.trim()}
    >
      {children}
    </span>
  );
}

export function LiveRegion({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`min-h-6 text-sm ${className}`.trim()}
    >
      {children}
    </p>
  );
}
