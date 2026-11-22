import type { ButtonHTMLAttributes } from "react";

type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "role" | "aria-checked" | "aria-label" | "children"
> & {
  checked: boolean;
  /** The accessible name; the visible label usually lives beside the switch. */
  label: string;
  onCheckedChange?: (checked: boolean) => void;
};

/**
 * An on/off switch. The repo had only `aria-pressed` pills; a setting that is
 * either on or off reads better as a switch. The state is carried by
 * `aria-checked` and the filled track, and the thumb travel is the CSS-only
 * `switch-motion` utility (shared hover duration and ease, zero under reduced
 * motion), so no animation ever decides whether the control exists.
 */
export function Switch({
  checked,
  label,
  onCheckedChange,
  className,
  disabled,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={`switch-motion relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-primary bg-primary" : "border-border bg-muted"
      }${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`switch-motion pointer-events-none block size-4 rounded-pill ${
          checked
            ? "translate-x-[1.375rem] bg-primary-foreground"
            : "translate-x-[0.1875rem] bg-muted-foreground"
        }`}
      />
    </button>
  );
}

export type { SwitchProps };
