import { StarIcon } from "@/components/ui/icons";

export function ReviewStars({
  rating,
  label,
  className = "",
}: {
  rating: number;
  label?: string;
  className?: string;
}) {
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-pink ${className}`.trim()}
      aria-label={label ?? `${rating} de 5 estrellas`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <StarIcon
          key={value}
          className={`size-4 ${value <= rounded ? "fill-current" : "text-rose"}`}
        />
      ))}
    </span>
  );
}

export function RatingInput({
  name,
  value,
  onChange,
  error,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-display text-sm font-bold text-ink">
        Calificación <span className="text-pink">*</span>
      </legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
        {[1, 2, 3, 4, 5].map((star) => {
          const checked = value === star;
          return (
            <label
              key={star}
              className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-2 px-3 font-display text-sm font-bold transition-colors ${
                checked ? "border-pink bg-rose text-plum" : "border-rose/60 bg-white text-muted hover:border-lavender"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={star}
                checked={checked}
                onChange={() => onChange(star)}
                className="sr-only"
                required={star === 1}
              />
              <span aria-hidden="true">{star}★</span>
              <span className="sr-only">{star} {star === 1 ? "estrella" : "estrellas"}</span>
            </label>
          );
        })}
      </div>
      {error ? <p className="text-sm text-pink">{error}</p> : null}
    </fieldset>
  );
}
