import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A link that looks like a `Button`.
 *
 * The workspace's calls to action all navigate, and a navigation is an anchor:
 * it has to be middle-clickable, copyable, and readable as a link to assistive
 * technology. `Button` renders a real `<button>` and stays that way for things
 * that submit or act — sign-out is still a form — so the shared part is the
 * class string, not the element.
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}

export type { ButtonLinkProps };
