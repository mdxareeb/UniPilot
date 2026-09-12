"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { noticeIn, noticeVariants } from "./presets";

type MotionNoticeProps = Omit<
  HTMLAttributes<HTMLParagraphElement>,
  "children" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  children?: ReactNode;
};

/**
 * One small drop-in entrance for inline feedback: auth errors, validation
 * messages, status lines. Fade + 4px drop at popover speed (180ms), no
 * delay — feedback must never make anyone wait for the message.
 *
 * Mount-only: when the message is dismissed it unmounts instantly, because
 * an exit animation on an error you have already fixed would be the
 * animation equivalent of clearing your throat.
 *
 * The hidden state is Motion's `initial`, identical on server and client, so
 * a server-rendered notice (an OAuth failure arriving on the login page)
 * hydrates cleanly and then animates in. Under `prefers-reduced-motion:
 * reduce` the duration is zero and the message simply appears.
 */
export function MotionNotice({ children, ...props }: MotionNoticeProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.p
      initial="hidden"
      animate="visible"
      variants={noticeVariants}
      transition={reduced ? { duration: 0 } : noticeIn}
      {...props}
    >
      {children}
    </motion.p>
  );
}

export type { MotionNoticeProps };
