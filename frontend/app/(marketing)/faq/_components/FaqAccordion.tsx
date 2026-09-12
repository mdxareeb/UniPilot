"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Collapsible } from "@/components/motion/Collapsible";

type FaqItem = {
  question: string;
  answer: string;
};

type FaqAccordionProps = {
  items: FaqItem[];
};

export function FaqAccordion({ items }: FaqAccordionProps) {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto max-w-2xl rounded-card border border-border bg-glass">
      <div className="divide-y divide-border">
        {items.map((item, index) => {
          const itemId = `${baseId}-${index}`;
          const triggerId = `${itemId}-trigger`;
          const panelId = `${itemId}-panel`;
          const open = openIds.has(itemId);
          return (
            <div key={itemId}>
              <button
                type="button"
                id={triggerId}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(itemId)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <h2 className="text-body-lg font-semibold text-foreground">
                  {item.question}
                </h2>
                <Plus
                  aria-hidden="true"
                  className={`size-4 shrink-0 text-muted-foreground icon-turn${
                    open ? " rotate-45" : ""
                  }`}
                />
              </button>
              {/* Padding lives on the content, not on the panel: the panel
                  collapses to zero height and its own box would survive as a
                  sliver. */}
              <Collapsible
                open={open}
                id={panelId}
                role="region"
                aria-labelledby={triggerId}
              >
                <div className="px-6 pb-5">
                  <p className="text-body-md text-muted-foreground">
                    {item.answer}
                  </p>
                </div>
              </Collapsible>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { FaqItem, FaqAccordionProps };
