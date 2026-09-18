"use client";

/**
 * The icon picker (Task D4, spec §5.4 icons row, §8.2 element palette).
 *
 * The engine's icon catalog is a vector store over its bundled SVGs
 * (`GET /api/v1/ppt/icons/search`), searched through a Server Action so the
 * browser never holds the API key. Results are normalized to engine-relative
 * `/static/icons/<weight>/…` paths; each thumbnail streams through the
 * owner-gated asset proxy — the picker previews, and the slide later renders,
 * the same proxy URL (spec §6.9).
 *
 * The weight filter is the engine's own `icon_weight` parameter (`thin` …
 * `bold`; the engine's default is bold) and re-runs the search, mirroring the
 * fork's icon editor. Clicking a result runs the generic insert validation
 * first (engine-public `/static/**` paths pass it), then replaces the
 * element's `data` and sets `is_icon` through the editor's single-slide
 * save path. An empty catalog is stated honestly — no icon is ever faked.
 */
import { useCallback, useRef, useState } from "react";
import { Search } from "lucide-react";
import { MotionNotice } from "@/components/motion/MotionNotice";
import {
  MotionRevealGroup,
  MotionRevealItem,
} from "@/components/motion/MotionRevealGroup";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import {
  searchPresentationIconsAction,
  validatePresentationImageSourceAction,
} from "@/lib/data/presentationActions";
import type { PresentonIcon } from "@/lib/integrations/presenton";
import { deckAssetUrl } from "@/lib/presentation/elements";
import {
  DEFAULT_ICON_WEIGHT,
  iconWeightFromPath,
  normalizeIconWeight,
} from "@/lib/presentation/icons";
import type { IconType } from "@/lib/presentation/types";

export type IconPickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The UniPilot presentation row id (owner gate + asset proxy). */
  presentationId: string;
  /** The element's current `data`, highlighted in the results when present. */
  currentSource: string | null;
  /** Receives the normalized engine icon path of the clicked result. */
  onSelect: (path: string) => void;
};

const WEIGHT_OPTIONS = [
  { value: "bold", label: "Bold" },
  { value: "duotone", label: "Duotone" },
  { value: "fill", label: "Fill" },
  { value: "light", label: "Light" },
  { value: "regular", label: "Regular" },
  { value: "thin", label: "Thin" },
] as const;

export function IconPickerModal({
  open,
  onOpenChange,
  presentationId,
  currentSource,
  onSelect,
}: IconPickerModalProps) {
  const [query, setQuery] = useState("");
  /** Defaults to the current icon's weight, else the engine's own default. */
  const [weight, setWeight] = useState<IconType>(
    () => iconWeightFromPath(currentSource ?? "") ?? DEFAULT_ICON_WEIGHT,
  );
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PresentonIcon[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  /** The latest search wins: a weight change supersedes an in-flight search. */
  const searchRequestRef = useRef(0);

  const runSearch = useCallback(
    async (weightOverride?: IconType) => {
      const normalized = query.trim();
      if (normalized === "") return;
      const request = searchRequestRef.current + 1;
      searchRequestRef.current = request;
      const selectedWeight = weightOverride ?? weight;
      setSearching(true);
      setSearchError(null);
      setInsertError(null);
      const result = await searchPresentationIconsAction({
        presentationId,
        query: normalized,
        weight: selectedWeight,
      });
      if (request !== searchRequestRef.current) return;
      setSearching(false);
      if (result.error !== null) {
        setResults([]);
        setSearchError(result.error);
        return;
      }
      setResults(result.icons);
    },
    [presentationId, query, weight],
  );

  const choose = useCallback(
    async (icon: PresentonIcon) => {
      if (validating) return;
      setInsertError(null);
      setValidating(true);
      /* The generic insert validation: engine-public paths pass outright; the
         server stays the authority and the picker never commits a refusal. */
      const result = await validatePresentationImageSourceAction({
        presentationId,
        source: icon.path,
      });
      setValidating(false);
      if (result.error !== null) {
        setInsertError(result.error);
        return;
      }
      onSelect(icon.path);
      onOpenChange(false);
    },
    [onOpenChange, onSelect, presentationId, validating],
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Insert an icon"
      description="Search the engine's icon catalog. Picking one replaces the selected element's source and marks it as an icon."
      className="max-w-3xl"
    >
      <Card
        data-icon-picker=""
        className="flex flex-col gap-4 bg-glass p-4 backdrop-blur-md"
      >
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label
              htmlFor="icon-search-query"
              className="text-label-sm font-medium text-foreground"
            >
              Search icons
            </label>
            <Input
              id="icon-search-query"
              data-icon-search-input=""
              size="sm"
              type="search"
              maxLength={200}
              placeholder="e.g. lightbulb"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex w-36 flex-col gap-1">
            <label
              htmlFor="icon-search-weight"
              className="text-label-sm font-medium text-foreground"
            >
              Weight
            </label>
            <div data-icon-weight="">
              <Select
                id="icon-search-weight"
                size="sm"
                value={weight}
                onChange={(value) => {
                  const next = normalizeIconWeight(value);
                  setWeight(next);
                  if (query.trim() !== "") void runSearch(next);
                }}
                options={[...WEIGHT_OPTIONS]}
                aria-label="Icon weight"
              />
            </div>
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            data-icon-search-submit=""
            disabled={searching || query.trim() === ""}
          >
            {searching ? "Searching…" : "Search"}
          </Button>
        </form>

        {insertError !== null ? (
          <MotionNotice
            role="alert"
            data-icon-insert-error=""
            className="text-label-sm text-destructive"
          >
            {insertError}
          </MotionNotice>
        ) : null}

        {searchError !== null ? (
          <MotionNotice
            role="alert"
            data-icon-unavailable=""
            className="text-label-sm text-muted-foreground"
          >
            {searchError}
          </MotionNotice>
        ) : null}

        {searchError === null && results.length > 0 ? (
          <MotionRevealGroup
            key={results.map((icon) => icon.path).join("|")}
            className="grid grid-cols-3 gap-2 sm:grid-cols-5"
          >
            {results.map((icon) => {
              const src = deckAssetUrl(presentationId, icon.path);
              const selected = currentSource === icon.path;
              return (
                <MotionRevealItem key={icon.path} variant="scale">
                  <button
                    type="button"
                    data-icon-tile=""
                    data-icon-path={icon.path}
                    data-icon-tile-selected={selected ? "true" : undefined}
                    aria-pressed={selected}
                    title={icon.path}
                    disabled={validating}
                    onClick={() => void choose(icon)}
                    /* Engine icons are black-on-transparent (`currentColor`
                       inside an `<img>` is black), so the preview pad is a
                       fixed light surface in both themes — a dark pad would
                       make every thumbnail invisible. */
                    className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-nested border border-border bg-white p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {src !== null ? (
                      /* eslint-disable-next-line @next/next/no-img-element --
                         engine bytes stream through the owner-gated asset proxy
                         (spec §6.9); the optimizer cannot re-request them. */
                      <img
                        alt=""
                        src={src}
                        loading="lazy"
                        draggable={false}
                        className="size-full object-contain"
                      />
                    ) : (
                      <Search
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                    )}
                  </button>
                </MotionRevealItem>
              );
            })}
          </MotionRevealGroup>
        ) : null}

        {searchError === null && !searching && results.length === 0 ? (
          <p
            data-icon-empty=""
            className="text-label-sm text-muted-foreground"
          >
            Search the engine&apos;s bundled icon catalog by subject — e.g.
            &ldquo;lightbulb&rdquo;, &ldquo;chart&rdquo;, &ldquo;users&rdquo;.
          </p>
        ) : null}
      </Card>
    </Modal>
  );
}
