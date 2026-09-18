"use client";

/**
 * The viewer's and presenter's shared key-handling policy (Task B4).
 *
 * Space is a navigation key for a deck, but it is also the native activation
 * key of whatever control has focus: a button, a link, a checkbox. When the
 * focused element owns Space, the deck handlers must leave the event alone —
 * otherwise pressing Space on "Present" would advance the slide and never
 * press the button. Arrow/Page keys have no native meaning on those controls,
 * so they stay with the deck navigation.
 */
export function targetOwnsSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("button, a[href], input, select, textarea") !== null;
}
