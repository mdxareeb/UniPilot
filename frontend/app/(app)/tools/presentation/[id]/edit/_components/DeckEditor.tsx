"use client";

/**
 * The native deck editor (Task C4, spec §7.4–§7.10, §8.1–§8.3).
 *
 * The stage is the same `DeckStage` the viewer renders (chrome-free deck
 * content); selection and inline text editing ride a scaled overlay in the
 * same fitted box — top-level text elements are click targets, the selected
 * one becomes a native `contenteditable` for plain-text, run-preserving edits
 * (spec §6.4, Escape commits, Tab moves to the next element). The rail carries
 * thumbnails and the structural toolbar, the inspector carries rename, theme,
 * layout, notes and the selected element's text.
 *
 * Every edit lands in one local state (`useDeckHistory`, snapshots ≤30 with
 * Mod+Z / Mod+Shift+Z / Mod+Y) and is autosaved by `useDeckAutosave` through
 * the Server Actions — the browser never talks to Presenton (§7.2). Structural
 * controls are `[!]` gated by the engine flag; export enqueues the worker job
 * and polls the row with `router.refresh()` until the mirror settles.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Redo2,
  Undo2,
} from "lucide-react";
import { motionIndex } from "@/components/motion/stagger";
import { MotionNotice } from "@/components/motion/MotionNotice";
import {
  DECK_STAGE_HEIGHT,
  DECK_STAGE_WIDTH,
  DeckStage,
} from "@/components/presentation/DeckStage";
import {
  SelectionLayer,
  type SelectionOverlayFrame,
} from "@/components/presentation/editor/SelectionLayer";
import { useElementDrag } from "@/components/presentation/editor/useElementDrag";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import {
  applyBoundedMove,
  applyElementResize,
  canFrameResize,
  canGroupSelection,
  canUngroupSelection,
  commandForArrowKey,
  elementStageFrame,
  groupSelection,
  hasVisibleFrame,
  isEditableTarget,
  reorderSelection,
  resizeFrame,
  rotationFromGesture,
  selectionFrames,
  ungroupSelection,
  type ResizeHandle,
  type SelectionFrame,
  type ZOrderDirection,
} from "@/lib/presentation/editorOps";
import {
  createElementClipboard,
  deleteElements,
  duplicateElements,
  ELEMENT_CLIPBOARD_MIME,
  ELEMENT_DUPLICATE_OFFSET,
  elementClipboardText,
  nextElementPasteOffset,
  parseElementClipboardText,
  pasteElementClipboard,
  readElementClipboard,
  rememberElementClipboard,
  serializeElementClipboard,
  type ElementClipboard,
} from "@/lib/presentation/clipboardOps";
import {
  deckFontEntries,
  collectAssetPaths,
  deckAssetUrl,
  elementBox,
  elementFrame,
  isTextRun,
  mergeRunFont,
  resolveDeckFontFamily,
  resolveDeckTheme,
} from "@/lib/presentation/elements";
import {
  applyImageBorderRadius,
  applyImageCrop,
  applyImageFit,
  applyImageFlip,
  applyImageOpacity,
  applyImageSource,
} from "@/lib/presentation/imageOps";
import { applyIconColor, applyIconSource } from "@/lib/presentation/icons";
import { hydrateSlide } from "@/lib/presentation/hydrateSlide";
import {
  applyRunFont,
  fontAtOffset,
  rangeSupportsRunFormatting,
  toggleRunFont,
  type RunFontKey,
  type RunFontPatch,
  type TextRange,
} from "@/lib/presentation/textRuns";
import type {
  ChartElement,
  DeckSlide,
  DeckTheme,
  DeckThemePackage,
  Font,
  HorizontalAlignment,
  ImageElement,
  PresentationDeck,
  SlideComponent,
  SlideElement,
  TableElement,
  TemplateLayout,
  TextElement,
  TextRunValue,
} from "@/lib/presentation/types";
import type { PresentationExportStatusValue } from "@/lib/data/presentationValues";
import {
  renamePresentationAction,
  requestExportAction,
  saveDeckAction,
  updatePresentationAction,
  updateSlideAction,
} from "@/lib/data/presentationActions";
import { ChartControls } from "./ChartControls";
import { EditorRail, STRUCTURAL_EDITING_REASON } from "./EditorRail";
import { IconPickerModal } from "./IconPickerModal";
import { ImageControls } from "./ImageControls";
import { ImagePickerModal } from "./ImagePickerModal";
import { InlineRunsEditor } from "./InlineRunsEditor";
import { InspectorPanel } from "./InspectorPanel";
import { LayoutPalette } from "./LayoutPalette";
import {
  addOnlyLayoutCount,
  buildLayoutPalette,
  layoutReplaceSupport,
  slideLimitReached,
} from "./layoutPaletteModel";
import { RunFormatToolbar } from "./RunFormatToolbar";
import { SaveStatus } from "./SaveStatus";
import { ShortcutsPopover } from "./ShortcutsPopover";
import { TableControls } from "./TableControls";
import { mergeStructuralAck } from "./structuralMerge";
import {
  buildThemeChoices,
  themeChoiceValue,
  themeForChoice,
  type ThemeChoiceEntry,
} from "./themeChoices";
import {
  useDeckAutosave,
  type SaveOutcome,
  type SaveTarget,
} from "./useDeckAutosave";
import { useDeckHistory, type DeckEditState } from "./useDeckHistory";
import {
  elementPathKey,
  getElementAtPath,
  listTextElements,
  parseElementPathKey,
  runsOfTextElement,
  setRunsOnElement,
  setTextOnElement,
  textOfTextElement,
  updateElementAtPath,
} from "./elementPath";

/** The row poll cadence while an export runs (the documents hub's 4 s). */
const EXPORT_POLL_MS = 4_000;
/** How long the click bridge may claim "exporting" before the row speaks. */
const EXPORT_BRIDGE_MS = 10_000;

const FALLBACK_SAVE_ERROR =
  "We couldn't save that change. Try again in a moment.";
const MISSING_THEME_ERROR =
  "This deck has no stored theme, so the structural save wasn't made.";

export type DeckEditorProps = {
  /** The UniPilot presentation row id (owner reads + asset proxy). */
  presentationId: string;
  deck: PresentationDeck;
  /** The joined document name, when the engine title is empty. */
  title: string;
  structuralEditsEnabled: boolean;
  templateTheme: DeckTheme | null;
  templateLayouts: TemplateLayout[] | null;
  templateName: string | null;
  /** The engine's custom themes (`GET /themes/all`), forwarded verbatim. */
  customThemes: ThemeChoiceEntry[];
  exportStatus: PresentationExportStatusValue | null;
  exportErrorMessage: string | null;
  /** When the last successful export replaced the deck's document. */
  exportedAt: string | null;
  /** The mirror or a queued job says an export is still running. */
  exportInFlight: boolean;
};

type SavedBaseline = {
  title: string;
  theme: DeckTheme | DeckThemePackage | null;
  slides: Map<string, DeckSlide>;
  order: string[];
};

type HitBox = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: SlideElement["type"];
};

/** A pointer transform (resize/rotate) in flight, in screen pixels. */
type TransformGesture = {
  kind: "resize" | "rotate";
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  frame: { x: number; y: number; width: number; height: number };
  rotation: number;
  baseAngle: number;
  handle?: ResizeHandle;
};

/** The minimum frame change a resize/rotate gesture must produce to commit. */
const TRANSFORM_COMMIT_EPSILON = 0.5;

/** Root-level elements have no component frame; their origin is 0,0. */
const ROOT_COMPONENT: SlideComponent = {
  id: "root",
  description: "Root elements",
  position: { x: 0, y: 0 },
  elements: [],
};

function freshId(): string {
  return crypto.randomUUID();
}

export function DeckEditor({
  presentationId,
  deck,
  title,
  structuralEditsEnabled,
  templateTheme,
  templateLayouts,
  templateName,
  customThemes,
  exportStatus,
  exportErrorMessage,
  exportedAt,
  exportInFlight,
}: DeckEditorProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const elementTextRef = useRef<HTMLTextAreaElement | null>(null);
  const [stageScale, setStageScale] = useState<number | null>(null);

  const savedRef = useRef<SavedBaseline | null>(null);

  const [initialState] = useState<DeckEditState>(() => ({
    slides: deck.slides,
    theme: deck.theme ?? null,
    title: deck.title?.trim() || title,
  }));

  const history = useDeckHistory(initialState);
  const {
    state,
    revision,
    canUndo,
    canRedo,
    apply,
    replace,
    bumpRevision,
    undo,
    redo,
    getState,
  } = history;

  const [selectedIndex, setSelectedIndex] = useState(0);
  /* Selection is a list of element path keys (D1 multi-select: Shift+click
     extends, Mod+G groups). The last entry is primary: it owns the transform
     handles and the inspector's single-element controls. */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [activeElementKey, setActiveElementKey] = useState<string | null>(null);
  /** The image picker (D3) for the primary selected image element. */
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  /* Which text element's inline editor actually holds the caret. Selection
     alone is not editing: a selected text element keeps its transform handles
     until the caret is live (typing), so resize/rotate stay reachable. */
  const [inlineFocusKey, setInlineFocusKey] = useState<string | null>(null);
  /* The live text selection inside the inline editor (display offsets over
     the concatenated run text), tagged with the element it belongs to. The
     run toolbar formats this range; a tag that no longer matches the active
     element reads as null (switching elements drops the selection), and null
     or collapsed means there is nothing to format (stated honestly). */
  const [runSelectionEntry, setRunSelectionEntry] = useState<{
    key: string | null;
    range: TextRange | null;
  }>({ key: null, range: null });
  const runSelection =
    runSelectionEntry.key === activeElementKey ? runSelectionEntry.range : null;
  const setRunSelection = useCallback(
    (range: TextRange | null) => {
      setRunSelectionEntry({ key: activeElementKey, range });
    },
    [activeElementKey],
  );
  const [transformGesture, setTransformGesture] =
    useState<TransformGesture | null>(null);
  const [transformFrame, setTransformFrame] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [transformRotation, setTransformRotation] = useState(0);
  /** The export request bridge: what the row said when Export was clicked. */
  const [exportRequest, setExportRequest] = useState<{
    status: PresentationExportStatusValue | null;
    exportedAt: string | null;
  } | null>(null);
  const [exportBridgeExpired, setExportBridgeExpired] = useState(false);
  const [exportRequestError, setExportRequestError] = useState<string | null>(
    null,
  );
  /* Why the last layout choice was refused (an add-only layout), tagged with
     the slide it belongs to: the remark cannot survive a slide change. */
  const [layoutChangeEntry, setLayoutChangeEntry] = useState<{
    slideId: string;
    reason: string;
  } | null>(null);

  const slides = state.slides;
  const selectedSlide = slides[selectedIndex] ?? null;
  const layoutChangeNote =
    layoutChangeEntry !== null && layoutChangeEntry.slideId === selectedSlide?.id
      ? layoutChangeEntry.reason
      : null;

  /* Clears the element selection; used by every slide-level action so a
     stale element key can never survive a slide change. */
  const clearSelection = useCallback(() => {
    setSelectedKeys([]);
    setActiveElementKey(null);
    setInlineFocusKey(null);
  }, []);

  /** The component whose origin offsets one selection key's frame. */
  const componentForSelection = useCallback(
    (key: string): SlideComponent => {
      const path = parseElementPathKey(key);
      const components =
        selectedSlide?.ui !== null && selectedSlide?.ui !== undefined
          ? Array.isArray(selectedSlide.ui.components)
            ? selectedSlide.ui.components
            : []
          : [];
      if (path !== null && path.root === "components") {
        const component = components[path.indexes[0]];
        if (component !== undefined) return component;
      }
      return ROOT_COMPONENT;
    },
    [selectedSlide],
  );

  /* The test/QA hydration marker: set directly so it never renders on the
     server (a server attribute would claim interactivity that is not there). */
  useEffect(() => {
    rootRef.current?.setAttribute("data-editor-ready", "true");
  }, []);

  /* The last acknowledged state, initialized from the loaded deck after mount
     (the save pipeline only ever runs from events/effects, never during
     render). */
  useEffect(() => {
    if (savedRef.current !== null) return;
    savedRef.current = {
      title: initialState.title,
      theme: initialState.theme,
      slides: new Map(initialState.slides.map((slide) => [slide.id, slide])),
      order: initialState.slides.map((slide) => slide.id),
    };
  }, [initialState]);

  /* The overlay shares `DeckStage`'s fit-width measurement: both read the same
     box, so an element's stage coordinates map to the same scaled pixels. */
  useEffect(() => {
    const node = stageBoxRef.current;
    if (node === null) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setStageScale(rect.width > 0 ? rect.width / DECK_STAGE_WIDTH : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const theme = useMemo(() => resolveDeckTheme(state.theme), [state.theme]);
  const localDeck = useMemo<PresentationDeck>(
    () => ({
      ...deck,
      title: state.title === "" ? deck.title : state.title,
      theme: state.theme,
      slides: state.slides,
    }),
    [deck, state.slides, state.theme, state.title],
  );

  // -------------------------------------------------------------------------
  // Save pipeline
  // -------------------------------------------------------------------------

  const runSave = useCallback(
    async (targets: SaveTarget[]): Promise<SaveOutcome> => {
      const current = getState();
      const baseline = savedRef.current;
      if (baseline === null) return { error: null };

      const wantsStructure = targets.some(
        (target) => target.kind === "structure",
      );
      const wantsMeta = targets.some((target) => target.kind === "meta");
      const slideIds = targets
        .filter(
          (target): target is { kind: "slide"; slideId: string } =>
            target.kind === "slide",
        )
        .map((target) => target.slideId);

      // Metadata first: a structural array save cannot carry a rename (the
      // engine's route refuses an ambiguous write), and title/theme are
      // independent of the slide rows.
      if (wantsMeta || wantsStructure) {
        if (current.title !== baseline.title) {
          const result = await renamePresentationAction({
            presentationId,
            title: current.title,
          });
          if (result.error !== null) return { error: result.error };
          baseline.title = current.title;
        }
        if (current.theme !== baseline.theme) {
          if (current.theme === null) return { error: MISSING_THEME_ERROR };
          const result = await updatePresentationAction({
            presentationId,
            theme: current.theme,
          });
          if (result.error !== null) return { error: result.error };
          baseline.theme = current.theme;
        }
      }

      if (!wantsStructure) {
        for (const slideId of slideIds) {
          const targetSlide = current.slides.find(
            (slide) => slide.id === slideId,
          );
          if (
            targetSlide === undefined ||
            baseline.slides.get(slideId) === targetSlide
          ) {
            continue;
          }
          const result = await updateSlideAction({
            presentationId,
            slide: targetSlide,
          });
          if (result.error !== null) return { error: result.error };
          baseline.slides.set(slideId, targetSlide);
        }
        return { error: null };
      }

      // Structural: fresh ids for every slide (the replace path re-inserts the
      // rows; a reused id collides when the engine's delete scope mismatches)
      // plus the stored count the route does not recompute.
      if (current.theme === null) return { error: MISSING_THEME_ERROR };
      const snapshot = current.slides;
      const fresh = snapshot.map((slide, index) => ({
        ...slide,
        id: freshId(),
        index,
      }));
      const result = await saveDeckAction({
        presentationId,
        deck: { theme: current.theme, slides: fresh },
      });
      if (result.error !== null) return { error: result.error };

      // Reconcile with edits that landed while the request was in flight: the
      // engine stores the fresh ids, but anything edited after the snapshot
      // was not part of the write — it must survive locally (mapped onto the
      // fresh ids) and re-save, never be replaced by the pre-await snapshot.
      const latest = getState();
      const merge = mergeStructuralAck({
        snapshot,
        acknowledged: fresh,
        latest: latest.slides,
      });
      // The server's truth is the snapshot content under the fresh ids. When
      // the local state diverged (a newer structural edit), it stays untouched
      // and its pending target rewrites the whole array; otherwise the merged
      // slides carry newer content that the pending, re-keyed targets re-save.
      baseline.slides = new Map(fresh.map((slide) => [slide.id, slide]));
      baseline.order = fresh.map((slide) => slide.id);
      if (!merge.diverged) {
        replace({ ...latest, slides: merge.slides });
      }
      const nextRevision = bumpRevision();
      return {
        error: null,
        ack: {
          idMap: merge.idMap,
          dropSlideTargets: merge.diverged,
          revision: nextRevision,
        },
      };
    },
    [bumpRevision, getState, presentationId, replace],
  );

  const autosave = useDeckAutosave({ save: runSave, revision });
  const { schedule, retry, status, error, saving } = autosave;

  const commit = useCallback(
    (next: DeckEditState, reason: string, targets: SaveTarget[]) => {
      apply(next, reason);
      for (const target of targets) schedule(target);
    },
    [apply, schedule],
  );

  /** Schedules whatever differs from the last acknowledged baseline. */
  const scheduleAgainstBaseline = useCallback((current: DeckEditState) => {
    const baseline = savedRef.current;
    if (baseline === null) return;
    const targets: SaveTarget[] = [];
    if (current.title !== baseline.title) targets.push({ kind: "meta" });
    if (current.theme !== baseline.theme) targets.push({ kind: "meta" });
    const order = current.slides.map((slide) => slide.id);
    const structural =
      order.length !== baseline.order.length ||
      order.some((id, index) => id !== baseline.order[index]);
    if (structural) {
      targets.push({ kind: "structure" });
    } else {
      for (const slide of current.slides) {
        if (baseline.slides.get(slide.id) !== slide) {
          targets.push({ kind: "slide", slideId: slide.id });
        }
      }
    }
    for (const target of targets) schedule(target);
  }, [schedule]);

  const handleUndo = useCallback(() => {
    const restored = undo();
    if (restored !== null) scheduleAgainstBaseline(restored);
  }, [scheduleAgainstBaseline, undo]);

  const handleRedo = useCallback(() => {
    const restored = redo();
    if (restored !== null) scheduleAgainstBaseline(restored);
  }, [redo, scheduleAgainstBaseline]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  // -------------------------------------------------------------------------
  // Edits
  // -------------------------------------------------------------------------

  const onTitleChange = useCallback(
    (value: string) => {
      commit({ ...getState(), title: value }, "meta-title", [
        { kind: "meta" },
      ]);
    },
    [commit, getState],
  );

  /* Picker inputs: the stored deck theme, the template's theme, and the
     engine's custom themes — the choice module owns labels and identity. */
  const themeChoiceInput = useMemo(
    () => ({
      storedTheme: deck.theme ?? null,
      templateTheme,
      templateName,
      customThemes,
    }),
    [customThemes, deck.theme, templateName, templateTheme],
  );

  const themeOptions = useMemo(
    () => buildThemeChoices(themeChoiceInput),
    [themeChoiceInput],
  );

  const themeValue = useMemo(() => {
    const matched = themeChoiceValue(state.theme, themeChoiceInput);
    if (themeOptions.some((choice) => choice.value === matched)) return matched;
    // The applied theme matches no listed choice (e.g. a stored theme equal to
    // none of them): fall back to the first option so the control is honest.
    return themeOptions[0]?.value ?? "deck";
  }, [state.theme, themeChoiceInput, themeOptions]);

  const onThemeChange = useCallback(
    (value: string) => {
      const next = themeForChoice(value, themeChoiceInput);
      if (next === null || next === undefined) return;
      commit({ ...getState(), theme: next }, "meta-theme", [
        { kind: "meta" },
      ]);
    },
    [commit, getState, themeChoiceInput],
  );

  const onNotesChange = useCallback(
    (value: string) => {
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id
          ? { ...candidate, speaker_note: value }
          : candidate,
      );
      commit({ ...current, slides: nextSlides }, "notes", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, getState, selectedIndex],
  );

  const textElements = useMemo(
    () => listTextElements(selectedSlide),
    [selectedSlide],
  );

  const selectedEntry =
    activeElementKey === null
      ? null
      : (textElements.find((entry) => entry.key === activeElementKey) ??
        null);

  /* ---------------------------------------------------------------------
     Element controls (D3 images/icons, D5 charts/tables): the primary
     selection's typed view decides which inspector section renders. Every
     section commits through the same single-slide path as every other write.
     --------------------------------------------------------------------- */

  const selectedElementAtPath = useMemo<SlideElement | null>(() => {
    if (activeElementKey === null) return null;
    const path = parseElementPathKey(activeElementKey);
    if (path === null) return null;
    return getElementAtPath(selectedSlide, path);
  }, [activeElementKey, selectedSlide]);

  const selectedImage: ImageElement | null =
    selectedElementAtPath?.type === "image" ? selectedElementAtPath : null;

  const selectedChart: ChartElement | null =
    selectedElementAtPath?.type === "chart" ? selectedElementAtPath : null;

  const selectedTable: TableElement | null =
    selectedElementAtPath?.type === "table" ? selectedElementAtPath : null;

  const imageSource = useMemo(
    () =>
      selectedImage === null
        ? null
        : deckAssetUrl(presentationId, selectedImage.data),
    [presentationId, selectedImage],
  );

  /* Only the sources the stored deck references preview through the asset
     proxy; the picker lists the rest by name (spec §6.9's membership rule). */
  const referencedImageSources = useMemo(
    () => (imagePickerOpen ? collectAssetPaths(localDeck) : []),
    [imagePickerOpen, localDeck],
  );

  /** One element-field write on the primary selection (one slide save). */
  const applyElementUpdate = useCallback(
    (reason: string, updater: (element: SlideElement) => SlideElement) => {
      if (activeElementKey === null) return;
      const path = parseElementPathKey(activeElementKey);
      if (path === null) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const element = getElementAtPath(slide, path);
      if (element === null) return;
      const nextElement = updater(element);
      if (nextElement === element) return;
      const nextSlide = updateElementAtPath(slide, path, () => nextElement);
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, reason, [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [activeElementKey, commit, getState, selectedIndex],
  );

  /** One image-field write on the primary selection (one slide save). */
  const applyImageUpdate = useCallback(
    (reason: string, updater: (element: ImageElement) => ImageElement) =>
      applyElementUpdate(reason, (element) =>
        element.type === "image" ? updater(element) : element,
      ),
    [applyElementUpdate],
  );

  /** The active selection frame (rotation + resize support for handles). */
  const activeFrame = useMemo<SelectionFrame | null>(() => {
    if (activeElementKey === null) return null;
    return (
      selectionFrames(selectedSlide, [activeElementKey])[0] ?? null
    );
  }, [activeElementKey, selectedSlide]);

  const onElementTextChange = useCallback(
    (value: string) => {
      if (activeElementKey === null) return;
      const path = parseElementPathKey(activeElementKey);
      if (path === null) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlide = updateElementAtPath(slide, path, (element) =>
        element.type === "text" ? setTextOnElement(element, value) : element,
      );
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, "text", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [activeElementKey, commit, getState, selectedIndex],
  );

  /* ---------------------------------------------------------------------
     Rich runs (D2): the inline editor owns the run array and the toolbar
     edits the live selection through the pure run ops. Both land on the
     same single-slide `slide_update` path as every other text write.
     --------------------------------------------------------------------- */

  /** Writes the inline editor's run array onto the selected element. */
  const onElementRunsChange = useCallback(
    (nextRuns: TextRunValue[]) => {
      if (activeElementKey === null) return;
      const path = parseElementPathKey(activeElementKey);
      if (path === null) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlide = updateElementAtPath(slide, path, (element) =>
        element.type === "text" ? setRunsOnElement(element, nextRuns) : element,
      );
      if (nextSlide === slide) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, "text-runs", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [activeElementKey, commit, getState, selectedIndex],
  );

  /** Applies one font patch to the toolbar's current selection. */
  const applyRunPatch = useCallback(
    (patch: RunFontPatch) => {
      if (selectedEntry === null || runSelection === null) return;
      const element = selectedEntry.element;
      const runs = runsOfTextElement(element);
      const nextRuns = applyRunFont(runs, runSelection, patch);
      if (nextRuns === runs) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlide = updateElementAtPath(slide, selectedEntry.path, (candidate) =>
        candidate.type === "text"
          ? setRunsOnElement(candidate, nextRuns)
          : candidate,
      );
      if (nextSlide === slide) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, "text-runs", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, getState, runSelection, selectedEntry, selectedIndex],
  );

  /**
   * Flips a boolean run property over a range (the toolbar's B/I/U and the
   * editor's Mod+B/I/U). The keyboard path passes the range that was live in
   * the event, so the flip cannot read a stale state update.
   */
  const applyRunToggle = useCallback(
    (key: RunFontKey, range?: TextRange | null) => {
      if (selectedEntry === null) return;
      const activeRange = range ?? runSelection;
      if (activeRange === null) return;
      const element = selectedEntry.element;
      const runs = runsOfTextElement(element);
      const nextRuns = toggleRunFont(
        runs,
        activeRange,
        element.font ?? null,
        key,
      );
      if (nextRuns === runs) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlide = updateElementAtPath(slide, selectedEntry.path, (candidate) =>
        candidate.type === "text"
          ? setRunsOnElement(candidate, nextRuns)
          : candidate,
      );
      if (nextSlide === slide) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, "text-runs", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, getState, runSelection, selectedEntry, selectedIndex],
  );

  /** Alignment is an element-level wire field, not a run property. */
  const onAlignmentChange = useCallback(
    (horizontal: HorizontalAlignment) => {
      if (selectedEntry === null) return;
      const element = selectedEntry.element;
      if (element.alignment?.horizontal === horizontal) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const nextSlide = updateElementAtPath(slide, selectedEntry.path, (candidate) =>
        candidate.type === "text"
          ? {
              ...candidate,
              alignment: { ...(candidate.alignment ?? {}), horizontal },
            }
          : candidate,
      );
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, "text-alignment", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, getState, selectedEntry, selectedIndex],
  );

  // -------------------------------------------------------------------------
  // Structural edits (gated)
  // -------------------------------------------------------------------------

  const applyStructure = useCallback(
    (nextSlides: DeckSlide[], reason: string) => {
      commit({ ...getState(), slides: nextSlides }, reason, [
        { kind: "structure" },
      ]);
    },
    [commit, getState],
  );

  const reindex = (list: DeckSlide[]): DeckSlide[] =>
    list.map((slide, index) => ({ ...slide, index }));

  const onAddSlide = useCallback(
    (layoutId: string) => {
      if (!structuralEditsEnabled) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      const layout = (templateLayouts ?? []).find(
        (candidate) => candidate.id === layoutId,
      );
      if (slide === undefined || layout === undefined) return;
      if (slideLimitReached(current.slides.length)) return;
      /* The new slide goes directly after the current one (Presenton's
         "Use Template +" spot), hydrated from the layout with empty content:
         template defaults are the truth for a fresh slide. */
      const nextSlide: DeckSlide = {
        id: freshId(),
        presentation: deck.id,
        layout_group: slide.layout_group,
        layout: layout.id,
        index: selectedIndex + 1,
        content: {},
        properties: null,
        ui: hydrateSlide({ layout, content: {} }),
        speaker_note: null,
      };
      const next = reindex([
        ...current.slides.slice(0, selectedIndex + 1),
        nextSlide,
        ...current.slides.slice(selectedIndex + 1),
      ]);
      setSelectedIndex(selectedIndex + 1);
      clearSelection();
      applyStructure(next, "structure-add");
    },
    [
      applyStructure,
      clearSelection,
      deck.id,
      getState,
      selectedIndex,
      structuralEditsEnabled,
      templateLayouts,
    ],
  );

  const onDuplicateSlide = useCallback(() => {
    if (!structuralEditsEnabled) return;
    const current = getState();
    const slide = current.slides[selectedIndex];
    if (slide === undefined || slideLimitReached(current.slides.length)) return;
    const copy: DeckSlide = { ...slide, id: freshId() };
    const next = reindex([
      ...current.slides.slice(0, selectedIndex + 1),
      copy,
      ...current.slides.slice(selectedIndex + 1),
    ]);
    setSelectedIndex(selectedIndex + 1);
    clearSelection();
    applyStructure(next, "structure-duplicate");
  }, [applyStructure, clearSelection, getState, selectedIndex, structuralEditsEnabled]);

  const onDeleteSlide = useCallback(() => {
    if (!structuralEditsEnabled) return;
    const current = getState();
    if (current.slides.length <= 1) return;
    const next = reindex(
      current.slides.filter((_, index) => index !== selectedIndex),
    );
    setSelectedIndex(Math.min(selectedIndex, next.length - 1));
    clearSelection();
    applyStructure(next, "structure-delete");
  }, [applyStructure, clearSelection, getState, selectedIndex, structuralEditsEnabled]);

  const onMoveSlide = useCallback(
    (delta: -1 | 1) => {
      if (!structuralEditsEnabled) return;
      const current = getState();
      const target = selectedIndex + delta;
      if (target < 0 || target >= current.slides.length) return;
      const next = [...current.slides];
      [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
      setSelectedIndex(target);
      clearSelection();
      applyStructure(reindex(next), "structure-reorder");
    },
    [applyStructure, clearSelection, getState, selectedIndex, structuralEditsEnabled],
  );

  const layoutOptions = useMemo(
    () =>
      structuralEditsEnabled && templateLayouts !== null
        ? templateLayouts.map((layout) => ({
            value: layout.id,
            label: layout.description?.trim() || layout.id,
          }))
        : [],
    [structuralEditsEnabled, templateLayouts],
  );

  /* The palette's groups: one per layout group today (the deck's template),
     labelled with the template name when the engine served one. */
  const layoutGroups = useMemo(() => {
    if (!structuralEditsEnabled || templateLayouts === null) return [];
    const groupId = deck.slides[0]?.layout_group ?? "template";
    const groupLabel =
      templateName !== null && templateName.trim() !== ""
        ? `${templateName.trim()} template`
        : `${groupId} template`;
    return buildLayoutPalette({
      layouts: templateLayouts,
      groupId,
      groupLabel,
    });
  }, [deck.slides, structuralEditsEnabled, templateLayouts, templateName]);

  const layoutDisabledReason = !structuralEditsEnabled
    ? STRUCTURAL_EDITING_REASON
    : templateLayouts === null
      ? "This deck's template layouts weren't available, so the layout can't be changed."
      : null;

  /* The honest count of add-only layouts (the ones the recorded repeated-group
     gap covers); the palette labels each entry, this is the summary line. */
  const layoutNote = useMemo(() => {
    const count = addOnlyLayoutCount(templateLayouts);
    if (count === 0) return null;
    return `${count} layout${count === 1 ? "" : "s"} can only be added as new slides — the engine's repeated-group expansion isn't mapped natively.`;
  }, [templateLayouts]);

  /* The replace path (inspector Select and palette): a layout the hydration
     module cannot map faithfully refuses with its recorded reason instead of
     silently dropping content. */
  const applyLayoutToSlide = useCallback(
    (layoutId: string) => {
      if (!structuralEditsEnabled) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      const layout = (templateLayouts ?? []).find(
        (candidate) => candidate.id === layoutId,
      );
      if (slide === undefined || layout === undefined) return;
      const support = layoutReplaceSupport(layout);
      if (!support.replaceable) {
        setLayoutChangeEntry({
          slideId: slide.id,
          reason: support.reason ?? "",
        });
        return;
      }
      setLayoutChangeEntry(null);
      const nextSlide: DeckSlide = {
        ...slide,
        layout: layout.id,
        ui: hydrateSlide({ layout, content: slide.content }),
      };
      const next = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      applyStructure(next, "structure-layout");
    },
    [applyStructure, getState, selectedIndex, structuralEditsEnabled, templateLayouts],
  );

  const onLayoutChange = useCallback(
    (layoutId: string) => applyLayoutToSlide(layoutId),
    [applyLayoutToSlide],
  );

  // -------------------------------------------------------------------------
  // Stage hit boxes, selection and transforms
  // -------------------------------------------------------------------------

  /* Every top-level element with a real frame is a hit target (D1: selection
     and drag are not text-only). Selected frames are skipped here — the
     selection layer's drag surface is their pointer target. */
  const hitBoxes = useMemo<HitBox[]>(() => {
    if (selectedSlide?.ui === null || selectedSlide?.ui === undefined) return [];
    const boxes: HitBox[] = [];
    const components = Array.isArray(selectedSlide.ui.components)
      ? selectedSlide.ui.components
      : [];
    components.forEach((component, componentIndex) => {
      const elements = Array.isArray(component.elements)
        ? component.elements
        : [];
      elements.forEach((element, elementIndex) => {
        if (!hasVisibleFrame(element, component)) return;
        const frame = elementFrame(element, component);
        boxes.push({
          key: elementPathKey({
            root: "components",
            indexes: [componentIndex, elementIndex],
          }),
          ...frame,
          type: element.type,
        });
      });
    });
    if (Array.isArray(selectedSlide.ui.elements)) {
      const root: SlideComponent = {
        id: "root",
        description: "Root elements",
        position: { x: 0, y: 0 },
        elements: [],
      };
      (selectedSlide.ui.elements as SlideElement[]).forEach(
        (element, elementIndex) => {
          if (!hasVisibleFrame(element, root)) return;
          const box = elementBox(element);
          boxes.push({
            key: elementPathKey({ root: "elements", indexes: [elementIndex] }),
            x: box.x,
            y: box.y,
            width: box.width ?? 0,
            height: box.height ?? 0,
            type: element.type,
          });
        },
      );
    }
    return boxes;
  }, [selectedSlide]);

  const selectedBox = useMemo(
    () =>
      activeElementKey === null
        ? null
        : (hitBoxes.find((box) => box.key === activeElementKey) ?? null),
    [activeElementKey, hitBoxes],
  );

  /** Selects one element (replacing the selection). */
  const selectElement = useCallback(
    (key: string | null) => {
      if (key === null) {
        clearSelection();
        return;
      }
      setSelectedKeys([key]);
      setActiveElementKey(key);
      setInlineFocusKey(null);
      const topLevel = hitBoxes.some((box) => box.key === key);
      if (!topLevel) {
        window.requestAnimationFrame(() => elementTextRef.current?.focus());
      }
    },
    [clearSelection, hitBoxes],
  );

  /** Shift+click: add to / remove from the selection. */
  const toggleElementSelection = useCallback((key: string) => {
    setInlineFocusKey(null);
    setSelectedKeys((current) => {
      if (current.includes(key)) {
        const next = current.filter((candidate) => candidate !== key);
        setActiveElementKey(next[next.length - 1] ?? null);
        return next;
      }
      setActiveElementKey(key);
      return [...current, key];
    });
  }, []);

  /** The pointer-down selection rule: plain click replaces, Shift extends. */
  const selectFromPointer = useCallback(
    (key: string, additive: boolean) => {
      if (additive) {
        toggleElementSelection(key);
        return;
      }
      setSelectedKeys((current) =>
        current.includes(key) ? current : [key],
      );
      setActiveElementKey(key);
      setInlineFocusKey(null);
    },
    [toggleElementSelection],
  );

  const onTabFromEditor = useCallback(
    (delta: -1 | 1) => {
      if (textElements.length === 0) return;
      const index = textElements.findIndex(
        (entry) => entry.key === activeElementKey,
      );
      const next =
        (index + delta + textElements.length) % textElements.length;
      selectElement(textElements[next]?.key ?? null);
    },
    [activeElementKey, selectElement, textElements],
  );

  /* ---------------------------------------------------------------------
     Spatial edits: one commit per gesture, through the normal autosave path
     (`slide_update` on the touched slide only — element order within one
     slide's `ui` never rotates ids).
     --------------------------------------------------------------------- */

  /** Writes one transform over every selected element and commits once. */
  const commitTransform = useCallback(
    (
      reason: string,
      transform: (
        element: SlideElement,
        frame: SelectionFrame,
      ) => SlideElement,
      /* Which selection keys the transform applies to. Moves default to the
         whole selection; resize/rotate target the single handle-owning key
         only (their math derives from that frame). */
      keys: string[] = selectedKeys,
    ) => {
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const frames = selectionFrames(slide, keys);
      if (frames.length === 0) return;
      let nextSlide = slide;
      for (const entry of frames) {
        const parsed = parseElementPathKey(entry.key);
        if (parsed === null) continue;
        nextSlide = updateElementAtPath(nextSlide, parsed, (element) =>
          transform(element, entry),
        );
      }
      if (nextSlide === slide) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? nextSlide : candidate,
      );
      commit({ ...current, slides: nextSlides }, reason, [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, getState, selectedIndex, selectedKeys],
  );

  const moveSelection = useCallback(
    (dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return;
      commitTransform("transform-move", (element, entry) =>
        applyBoundedMove(element, componentForSelection(entry.key), dx, dy),
      );
    },
    [commitTransform, componentForSelection],
  );

  const elementDrag = useElementDrag({
    scale: stageScale,
    onCommit: (offset) => {
      const dx = Math.round(offset.dx);
      const dy = Math.round(offset.dy);
      if (dx === 0 && dy === 0) return;
      moveSelection(dx, dy);
    },
  });

  /** Ends inline text editing so a spatial gesture owns the keyboard. */
  const endInlineEditing = useCallback(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.hasAttribute("data-editor-inline-text")
    ) {
      active.blur();
    }
  }, []);

  /**
   * Pointer capture for the stage box: a gesture that leaves the stage still
   * delivers move/up to the stable stage node, so its release commits to the
   * element it started on. Without it, an off-stage release stranded the
   * gesture and its stale offset was applied to whatever the next press
   * selected. Best-effort: the call can only fail once the pointer is gone,
   * in which case there is no gesture left to strand.
   */
  const captureStagePointer = useCallback((pointerId: number) => {
    const stage = stageBoxRef.current;
    if (stage === null) return;
    try {
      stage.setPointerCapture(pointerId);
    } catch {
      /* The pointer is no longer active. */
    }
  }, []);

  /** The grab handle and the frame surface start the same move gesture. */
  const beginDragFromHandle = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      endInlineEditing();
      captureStagePointer(event.pointerId);
      elementDrag.begin(event);
    },
    // `begin` is the stable gesture entry point; depending on the whole hook
    // object would churn the callback every render for no behavioral change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [captureStagePointer, elementDrag.begin, endInlineEditing],
  );

  const beginResize = useCallback(
    (handle: ResizeHandle, event: React.PointerEvent<HTMLElement>) => {
      if (activeFrame === null || activeElementKey === null) return;
      if (!canFrameResize(activeFrame.element)) return;
      if (!selectionFrames(selectedSlide, [activeElementKey])[0]) return;
      endInlineEditing();
      captureStagePointer(event.pointerId);
      setTransformGesture({
        kind: "resize",
        key: activeElementKey,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        frame: activeFrame.frame,
        rotation: activeFrame.element.rotation ?? 0,
        baseAngle: 0,
        handle,
      });
      setTransformFrame(activeFrame.frame);
    },
    [
      activeElementKey,
      activeFrame,
      captureStagePointer,
      endInlineEditing,
      selectedSlide,
    ],
  );

  const beginRotate = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (activeFrame === null || activeElementKey === null) return;
      const rect = stageBoxRef.current?.getBoundingClientRect() ?? null;
      if (rect === null) return;
      endInlineEditing();
      captureStagePointer(event.pointerId);
      const scale = stageScale !== null && stageScale > 0 ? stageScale : 1;
      const rotation = activeFrame.element.rotation ?? 0;
      const frame = activeFrame.frame;
      const center = {
        x: frame.x + frame.width / 2,
        y: frame.y + frame.height / 2,
      };
      const pointer = {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale,
      };
      setTransformGesture({
        kind: "rotate",
        key: activeElementKey,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        frame,
        rotation,
        baseAngle:
          (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) /
          Math.PI,
      });
      setTransformFrame(frame);
      setTransformRotation(rotation);
    },
    [
      activeElementKey,
      activeFrame,
      captureStagePointer,
      endInlineEditing,
      stageScale,
    ],
  );

  const onTransformMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (transformGesture === null) return;
      if (event.pointerId !== transformGesture.pointerId) return;
      const rect = stageBoxRef.current?.getBoundingClientRect() ?? null;
      const scale =
        stageScale !== null && stageScale > 0 ? stageScale : 1;
      const screenDx = event.clientX - transformGesture.startX;
      const screenDy = event.clientY - transformGesture.startY;
      const dx = screenDx / scale;
      const dy = screenDy / scale;
      if (transformGesture.kind === "resize" && transformGesture.handle) {
        const frame = resizeFrame({
          handle: transformGesture.handle,
          frame: transformGesture.frame,
          dx,
          dy,
          keepAspectRatio: event.shiftKey,
          rotation: transformGesture.rotation,
        });
        setTransformFrame(frame);
        return;
      }
      if (rect !== null) {
        const pointer = {
          x: (event.clientX - rect.left) / scale,
          y: (event.clientY - rect.top) / scale,
        };
        setTransformRotation(
          rotationFromGesture({
            startRotation: transformGesture.rotation,
            baseAngle: transformGesture.baseAngle,
            pointer,
            frame: transformGesture.frame,
            snap: event.shiftKey,
          }),
        );
      }
    },
    [stageScale, transformGesture],
  );

  const onTransformEnd = useCallback(() => {
    const gesture = transformGesture;
    if (gesture === null) return;
    const frame = transformFrame;
    const rotation = transformRotation;
    setTransformGesture(null);
    setTransformFrame(null);
    if (gesture.kind === "resize" && frame !== null) {
      const changed =
        Math.abs(frame.x - gesture.frame.x) > TRANSFORM_COMMIT_EPSILON ||
        Math.abs(frame.y - gesture.frame.y) > TRANSFORM_COMMIT_EPSILON ||
        Math.abs(frame.width - gesture.frame.width) > TRANSFORM_COMMIT_EPSILON ||
        Math.abs(frame.height - gesture.frame.height) > TRANSFORM_COMMIT_EPSILON;
      if (!changed) return;
      const target = frame;
      commitTransform(
        "transform-resize",
        (element, entry) =>
          applyElementResize(element, componentForSelection(entry.key), target),
        [gesture.key],
      );
      return;
    }
    if (gesture.kind === "rotate") {
      const changed = Math.abs(rotation - gesture.rotation) > TRANSFORM_COMMIT_EPSILON;
      if (!changed) return;
      const target = rotation;
      commitTransform(
        "transform-rotate",
        (element) => ({
          ...element,
          rotation: target,
        }),
        [gesture.key],
      );
    }
  }, [
    commitTransform,
    componentForSelection,
    transformFrame,
    transformGesture,
    transformRotation,
  ]);

  /**
   * A selection-changing keyboard command keeps the stage as the keyboard
   * owner: the re-render remounts the inline editor for a text element (its
   * mount focuses the contenteditable), which would otherwise swallow the
   * next command in the sequence. The focus lands after that commit, so the
   * stage wins.
   */
  const focusStage = useCallback(() => {
    window.requestAnimationFrame(() => stageBoxRef.current?.focus());
  }, []);

  /** The keyboard-only z-order path (Alt+J/K, Shift+Alt+J/K). */
  const applyZOrder = useCallback(
    (direction: ZOrderDirection) => {
      const key = selectedKeys[selectedKeys.length - 1];
      if (key === undefined) return;
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return;
      const result = reorderSelection(slide, key, direction);
      if (result === null) return;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? result.slide : candidate,
      );
      setSelectedKeys([result.key]);
      setActiveElementKey(result.key);
      focusStage();
      commit({ ...current, slides: nextSlides }, "transform-z-order", [
        { kind: "slide", slideId: slide.id },
      ]);
    },
    [commit, focusStage, getState, selectedIndex, selectedKeys],
  );

  const applyGroup = useCallback(() => {
    const current = getState();
    const slide = current.slides[selectedIndex];
    if (slide === undefined || !canGroupSelection(slide, selectedKeys)) return;
    const result = groupSelection(slide, selectedKeys);
    if (result === null) return;
    const nextSlides = current.slides.map((candidate) =>
      candidate.id === slide.id ? result.slide : candidate,
    );
    setSelectedKeys([result.key]);
    setActiveElementKey(result.key);
    commit({ ...current, slides: nextSlides }, "transform-group", [
      { kind: "slide", slideId: slide.id },
    ]);
  }, [commit, getState, selectedIndex, selectedKeys]);

  const applyUngroup = useCallback(() => {
    const current = getState();
    const slide = current.slides[selectedIndex];
    const key = selectedKeys[selectedKeys.length - 1];
    if (slide === undefined || key === undefined) return;
    if (!canUngroupSelection(slide, [key])) return;
    const result = ungroupSelection(slide, key);
    if (result === null) return;
    const nextSlides = current.slides.map((candidate) =>
      candidate.id === slide.id ? result.slide : candidate,
    );
    setSelectedKeys(result.keys);
    setActiveElementKey(result.keys[result.keys.length - 1] ?? null);
    /* Ungrouping can expose text elements, whose remounted editor would
       otherwise take the keyboard. */
    focusStage();
    commit({ ...current, slides: nextSlides }, "transform-ungroup", [
      { kind: "slide", slideId: slide.id },
    ]);
  }, [commit, focusStage, getState, selectedIndex, selectedKeys]);

  // -------------------------------------------------------------------------
  // Clipboard, duplicate, delete (D7)
  //
  // The selection is copied into the module-level buffer (`clipboardOps`),
  // pasted with a growing offset, duplicated in place and deleted — every
  // result lands through the same single-slide save path as every other edit
  // (autosave + undo). The OS clipboard is best-effort only: it is attempted
  // on copy/paste where the browser allows it, and a failure there never
  // changes what the in-app buffer does.
  // -------------------------------------------------------------------------

  /** Stores the selection in the in-app buffer; null when nothing to copy. */
  const copyElementSelection = useCallback((): ElementClipboard | null => {
    const current = getState();
    const slide = current.slides[selectedIndex];
    if (slide === undefined) return null;
    const payload = createElementClipboard(slide, selectedKeys);
    if (payload === null) return null;
    rememberElementClipboard(payload);
    return payload;
  }, [getState, selectedIndex, selectedKeys]);

  /** Applies one payload to the current slide (one slide save). */
  const applyClipboardPaste = useCallback(
    (payload: ElementClipboard): boolean => {
      const current = getState();
      const slide = current.slides[selectedIndex];
      if (slide === undefined) return false;
      const result = pasteElementClipboard(slide, payload, {
        offset: nextElementPasteOffset(),
        anchorKey: activeElementKey,
        makeId: freshId,
      });
      if (result === null) return false;
      const nextSlides = current.slides.map((candidate) =>
        candidate.id === slide.id ? result.slide : candidate,
      );
      setSelectedKeys(result.keys);
      setActiveElementKey(result.keys[result.keys.length - 1] ?? null);
      setInlineFocusKey(null);
      focusStage();
      commit({ ...current, slides: nextSlides }, "clipboard-paste", [
        { kind: "slide", slideId: slide.id },
      ]);
      return true;
    },
    [activeElementKey, commit, focusStage, getState, selectedIndex],
  );

  const pasteElementSelection = useCallback((): boolean => {
    const payload = readElementClipboard();
    if (payload === null) return false;
    return applyClipboardPaste(payload);
  }, [applyClipboardPaste]);

  const duplicateElementSelection = useCallback((): boolean => {
    if (selectedKeys.length === 0) return false;
    const current = getState();
    const slide = current.slides[selectedIndex];
    if (slide === undefined) return false;
    const result = duplicateElements(slide, selectedKeys, {
      offset: ELEMENT_DUPLICATE_OFFSET,
      makeId: freshId,
    });
    if (result === null) return false;
    const nextSlides = current.slides.map((candidate) =>
      candidate.id === slide.id ? result.slide : candidate,
    );
    setSelectedKeys(result.keys);
    setActiveElementKey(result.keys[result.keys.length - 1] ?? null);
    setInlineFocusKey(null);
    focusStage();
    commit({ ...current, slides: nextSlides }, "element-duplicate", [
      { kind: "slide", slideId: slide.id },
    ]);
    return true;
  }, [commit, focusStage, getState, selectedIndex, selectedKeys]);

  const deleteElementSelection = useCallback((): boolean => {
    if (selectedKeys.length === 0) return false;
    const current = getState();
    const slide = current.slides[selectedIndex];
    if (slide === undefined) return false;
    const result = deleteElements(slide, selectedKeys);
    if (result === null) return false;
    const nextSlides = current.slides.map((candidate) =>
      candidate.id === slide.id ? result.slide : candidate,
    );
    clearSelection();
    focusStage();
    commit({ ...current, slides: nextSlides }, "element-delete", [
      { kind: "slide", slideId: slide.id },
    ]);
    return true;
  }, [clearSelection, commit, focusStage, getState, selectedIndex, selectedKeys]);

  /** Best-effort `navigator.clipboard` write (Mod+C); failures are silent. */
  const writeOsElementClipboard = useCallback((payload: ElementClipboard) => {
    if (typeof navigator === "undefined") return;
    if (typeof navigator.clipboard?.writeText !== "function") return;
    try {
      void navigator.clipboard
        .writeText(elementClipboardText(payload))
        .catch(() => undefined);
    } catch {
      /* The in-app buffer still owns paste. */
    }
  }, []);

  /**
   * Best-effort `navigator.clipboard` read for Mod+V when the in-app buffer
   * is empty. The stage must still own focus when the promise settles, so a
   * slow permission prompt cannot paste into a surface the user moved on to.
   */
  const pasteFromOsClipboard = useCallback(() => {
    if (typeof navigator === "undefined") return;
    if (typeof navigator.clipboard?.readText !== "function") return;
    void (async () => {
      try {
        const text = await navigator.clipboard.readText();
        const stage = stageBoxRef.current;
        const active = document.activeElement;
        if (stage === null || active === null || !stage.contains(active)) {
          return;
        }
        const payload = parseElementClipboardText(text);
        if (payload !== null) applyClipboardPaste(payload);
      } catch {
        /* A denied or empty OS clipboard changes nothing. */
      }
    })();
  }, [applyClipboardPaste]);

  /* The OS clipboard's copy/paste events (context menu, Edit menu) ride the
     same buffer. The shortcut path preventDefaults its own keydown, so these
     listeners only see the menu gestures; both paths are best-effort. */
  useEffect(() => {
    const surfaceActive = (target: EventTarget | null): boolean => {
      if (isEditableTarget(target)) return false;
      const stage = stageBoxRef.current;
      const active = document.activeElement;
      return stage !== null && active !== null && stage.contains(active);
    };

    const onCopy = (event: ClipboardEvent) => {
      if (!surfaceActive(event.target)) return;
      const payload = copyElementSelection();
      if (payload === null) return;
      try {
        event.clipboardData?.setData(
          ELEMENT_CLIPBOARD_MIME,
          serializeElementClipboard(payload),
        );
        event.clipboardData?.setData(
          "text/plain",
          elementClipboardText(payload),
        );
        event.preventDefault();
      } catch {
        /* The in-app buffer already holds the payload. */
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (!surfaceActive(event.target)) return;
      let payload: ElementClipboard | null = null;
      try {
        const custom =
          event.clipboardData?.getData(ELEMENT_CLIPBOARD_MIME) ?? "";
        const plain = event.clipboardData?.getData("text/plain") ?? "";
        payload = parseElementClipboardText(custom !== "" ? custom : plain);
      } catch {
        payload = null;
      }
      if (payload === null) return;
      if (applyClipboardPaste(payload)) event.preventDefault();
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [applyClipboardPaste, copyElementSelection]);

  /* Keyboard equivalents (spec §8.5): arrows move 1px / Shift 10px; the
     fork's layering chords Alt+J/K (and Shift+Alt+J/K); Mod+G / Mod+Shift+G
     group and ungroup; Mod+C / Mod+V / Mod+D copy, paste and duplicate; Delete
     and Backspace remove the selection. The commands belong to the stage:
     focus must actually be inside the stage box (a toolbar button, the shell
     or the body means the keys are not ours), and never inside a text field —
     inline text editing and every input keep their own clipboard/undo
     behavior. A sticky "stage was used once" flag used to let arrows nudge and
     autosave from anywhere. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const stage = stageBoxRef.current;
      const active = document.activeElement;
      if (stage === null || active === null || !stage.contains(active)) return;
      if (isEditableTarget(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();

      if (mod && !event.altKey && key === "g") {
        event.preventDefault();
        if (shift) applyUngroup();
        else applyGroup();
        return;
      }

      if (mod && !event.altKey && !shift) {
        if (key === "c") {
          const payload = copyElementSelection();
          if (payload !== null) {
            event.preventDefault();
            writeOsElementClipboard(payload);
          }
          return;
        }
        if (key === "v") {
          event.preventDefault();
          if (!pasteElementSelection()) pasteFromOsClipboard();
          return;
        }
        if (key === "d") {
          /* The stage owns the chord even with nothing selected: letting
             Ctrl+D through would open the browser's bookmark dialog. */
          event.preventDefault();
          duplicateElementSelection();
          return;
        }
      }

      if (event.altKey && !mod && (key === "j" || key === "k")) {
        event.preventDefault();
        applyZOrder(
          key === "j"
            ? shift
              ? "to-back"
              : "backward"
            : shift
              ? "to-front"
              : "forward",
        );
        return;
      }

      if (!mod && !event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
        if (deleteElementSelection()) event.preventDefault();
        return;
      }

      const command = commandForArrowKey(event.key, shift);
      if (command !== null && command.kind === "nudge") {
        event.preventDefault();
        moveSelection(command.dx, command.dy);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    applyGroup,
    applyUngroup,
    applyZOrder,
    copyElementSelection,
    deleteElementSelection,
    duplicateElementSelection,
    moveSelection,
    pasteElementSelection,
    pasteFromOsClipboard,
    writeOsElementClipboard,
  ]);

  /* The move gesture's live values (read outside the memo so the overlay
     only recomputes when the pointer actually moved). */
  const dragging = elementDrag.dragging;
  const dragOffset = elementDrag.offset;

  /**
   * The selected frames the overlay renders (selection + gesture live). A
   * pointer move previews the committed geometry exactly: the same bounded
   * move the release will apply, so what the user sees is what is saved.
   */
  const overlayFrames = useMemo<SelectionOverlayFrame[]>(() => {
    const frames = selectionFrames(selectedSlide, selectedKeys);
    const gesture = transformGesture;
    return frames.map((entry) => {
      const resizeEnabled = canFrameResize(entry.element);
      const rotation = entry.element.rotation ?? 0;
      if (gesture !== null && gesture.key === entry.key) {
        return {
          key: entry.key,
          frame: transformFrame ?? entry.frame,
          rotation: gesture.kind === "rotate" ? transformRotation : rotation,
          element: entry.element,
          resizeEnabled,
        };
      }
      if (dragging && (dragOffset.dx !== 0 || dragOffset.dy !== 0)) {
        const component = componentForSelection(entry.key);
        const moved = applyBoundedMove(
          entry.element,
          component,
          dragOffset.dx,
          dragOffset.dy,
        );
        return {
          key: entry.key,
          frame: elementStageFrame(moved, component),
          rotation,
          element: entry.element,
          resizeEnabled,
        };
      }
      return {
        key: entry.key,
        frame: entry.frame,
        rotation,
        element: entry.element,
        resizeEnabled,
      };
    });
  }, [
    componentForSelection,
    dragOffset.dx,
    dragOffset.dy,
    dragging,
    selectedKeys,
    selectedSlide,
    transformFrame,
    transformGesture,
    transformRotation,
  ]);

  const elementFont = useMemo(() => {
    if (selectedEntry === null) return null;
    const element = selectedEntry.element;
    const firstRun = Array.isArray(element.runs) ? element.runs[0] : undefined;
    const runFont =
      firstRun !== undefined && isTextRun(firstRun)
        ? (firstRun as { font?: TextElement["font"] }).font
        : undefined;
    return mergeRunFont(element.font, runFont ?? undefined);
  }, [selectedEntry]);

  const deckFonts = useMemo(() => deckFontEntries(deck.fonts), [deck.fonts]);
  const editorFontFamily = useMemo(() => {
    if (elementFont?.family) {
      return resolveDeckFontFamily(elementFont.family, deckFonts);
    }
    const themeFont = theme?.fonts?.textFont?.name ?? null;
    return resolveDeckFontFamily(themeFont, deckFonts);
  }, [deckFonts, elementFont, theme]);

  const inlineEditorStyle = useMemo<CSSProperties | null>(() => {
    if (selectedEntry === null) return null;
    const frame = selectionFrames(selectedSlide, [selectedEntry.key])[0]?.frame;
    if (frame === undefined) return null;
    const font = elementFont ?? {};
    return {
      position: "absolute",
      left: 0,
      top: 0,
      width: frame.width,
      height: frame.height,
      pointerEvents: "auto",
      color: font.color ?? "#111827",
      fontSize: font.size ?? undefined,
      fontFamily:
        (elementFont?.family
          ? resolveDeckFontFamily(elementFont.family, deckFonts)
          : editorFontFamily) ?? undefined,
      fontWeight: font.bold ? 700 : undefined,
      fontStyle: font.italic ? "italic" : undefined,
      textDecoration: font.underline ? "underline" : undefined,
      letterSpacing: font.letter_spacing ?? undefined,
      lineHeight: font.line_height ?? 1.1,
      textAlign:
        selectedEntry.element.alignment?.horizontal === "center"
          ? "center"
          : selectedEntry.element.alignment?.horizontal === "right"
            ? "right"
            : selectedEntry.element.alignment?.horizontal === "justify"
              ? "justify"
              : "left",
      backgroundColor: theme?.colors.background ?? "#FFFFFF",
    };
  }, [deckFonts, editorFontFamily, elementFont, selectedEntry, selectedSlide, theme]);

  /* ---------------------------------------------------------------------
     Run toolbar state (D2): the selection's effective font drives the
     controls; the range decides whether run formatting is possible at all.
     --------------------------------------------------------------------- */

  const elementRuns = useMemo(
    () => (selectedEntry === null ? [] : runsOfTextElement(selectedEntry.element)),
    [selectedEntry],
  );

  const canFormatRuns =
    selectedEntry !== null &&
    runSelection !== null &&
    rangeSupportsRunFormatting(elementRuns, runSelection);

  /** What the controls show: the selection's effective font, else the element's. */
  const toolbarFont: Font = useMemo(() => {
    if (selectedEntry === null) return {};
    if (runSelection !== null && canFormatRuns) {
      return fontAtOffset(
        elementRuns,
        selectedEntry.element.font ?? null,
        runSelection.start,
      );
    }
    return elementFont ?? {};
  }, [canFormatRuns, elementFont, elementRuns, runSelection, selectedEntry]);

  const runDisabledReason =
    selectedEntry === null
      ? "Select a text element first."
      : runSelection === null || runSelection.start === runSelection.end
        ? "Select text in the element to format the run."
        : !canFormatRuns
          ? "LaTeX runs render as raw source and aren't formatted here."
          : null;

  const runFamilyOptions = useMemo(() => {
    const options = [{ value: "", label: "Theme font" }];
    for (const entry of deckFontEntries(deck.fonts)) {
      options.push({ value: entry.family, label: entry.family });
    }
    const current = toolbarFont.family;
    if (
      typeof current === "string" &&
      current !== "" &&
      !options.some((option) => option.value === current)
    ) {
      options.push({ value: current, label: current });
    }
    return options;
  }, [deck.fonts, toolbarFont.family]);

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /* Between the click and the worker's first mirror write the row may still
     read null (or an older export), so a click bridges the gap: the control
     stays disabled until the row moves past the recorded baseline, the poll
     keeps asking, and a bounded bridge expires so a silent failure cannot lock
     the control forever. `exportInFlight` (mirror or queued job) takes over
     whenever the server has spoken. */
  const exportSettledSinceRequest =
    exportRequest !== null &&
    (exportStatus === "succeeded" || exportStatus === "failed") &&
    (exportStatus !== exportRequest.status ||
      (exportedAt ?? null) !== exportRequest.exportedAt);
  const exporting =
    exportInFlight ||
    (exportRequest !== null &&
      !exportSettledSinceRequest &&
      !exportBridgeExpired);

  useEffect(() => {
    if (exportRequest === null || exportBridgeExpired) return;
    const timer = window.setTimeout(
      () => setExportBridgeExpired(true),
      EXPORT_BRIDGE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [exportBridgeExpired, exportRequest]);

  useEffect(() => {
    if (!exporting) return;
    const timer = window.setInterval(() => router.refresh(), EXPORT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [exporting, router]);

  const onExport = useCallback(async () => {
    setExportRequestError(null);
    setExportBridgeExpired(false);
    setExportRequest({
      status: exportStatus ?? null,
      exportedAt: exportedAt ?? null,
    });
    let result: Awaited<ReturnType<typeof requestExportAction>>;
    try {
      result = await requestExportAction({ presentationId });
    } catch {
      result = { error: FALLBACK_SAVE_ERROR };
    }
    if (result.error !== null) {
      setExportRequest(null);
      setExportRequestError(result.error);
    }
  }, [exportStatus, exportedAt, presentationId]);

  const exportStatusLabel =
    exportStatus === "succeeded"
      ? "Exported"
      : exportStatus === "failed"
        ? "Export failed"
        : exporting
          ? "Exporting…"
          : null;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const notes =
    typeof selectedSlide?.speaker_note === "string"
      ? selectedSlide.speaker_note
      : "";
  const elementHint = "Select a text element on the slide or in the list.";

  if (slides.length === 0) {
    return (
      <div ref={rootRef} data-deck-editor="" className="min-w-0">
        <Card className="bg-glass p-6 backdrop-blur-md md:p-8">
          <p className="text-body-md text-muted-foreground">
            This deck has no slides stored on the presentation service, so
            there is nothing to edit. Nothing is faked in its place.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-deck-editor=""
      className="flex min-w-0 flex-col gap-4"
    >
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-glass p-3 backdrop-blur-md">
        <SaveStatus status={status} error={error} onRetry={retry} />
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="History"
            className="flex items-center gap-1"
          >
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              aria-label="Undo"
              disabled={!canUndo}
              data-editor-undo=""
              onClick={handleUndo}
            >
              <Undo2 aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton
              type="button"
              variant="outline"
              size="sm"
              aria-label="Redo"
              disabled={!canRedo}
              data-editor-redo=""
              onClick={handleRedo}
            >
              <Redo2 aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
          {exportStatusLabel !== null ? (
            <span
              data-editor-export-status={exportStatus ?? (exporting ? "queued" : "")}
              className={`font-mono text-label-sm ${
                exportStatus === "failed"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {exportStatusLabel}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            data-editor-export=""
            disabled={saving || exporting}
            onClick={() => void onExport()}
          >
            <Download aria-hidden="true" className="size-4" />
            {exporting ? "Exporting…" : "Export"}
          </Button>
          <ShortcutsPopover />
        </div>
      </Card>

      {exportRequestError !== null ? (
        <MotionNotice
          role="alert"
          className="text-label-sm text-destructive"
        >
          {exportRequestError}
        </MotionNotice>
      ) : null}
      {exportStatus === "failed" && exportErrorMessage !== null ? (
        <MotionNotice
          role="alert"
          className="text-label-sm text-destructive"
        >
          {exportErrorMessage}
        </MotionNotice>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)_20rem]">
        <div data-enter style={motionIndex(1)} className="min-w-0">
          <EditorRail
            deck={localDeck}
            id={presentationId}
            slideIndex={selectedIndex}
            onSelect={(index) => {
              setSelectedIndex(index);
              clearSelection();
            }}
            structuralEditsEnabled={structuralEditsEnabled}
            layoutGroups={layoutGroups}
            layoutDisabledReason={layoutDisabledReason}
            onAddSlide={onAddSlide}
            onApplyLayout={applyLayoutToSlide}
            onDuplicateSlide={onDuplicateSlide}
            onDeleteSlide={onDeleteSlide}
            onMoveSlide={onMoveSlide}
            atSlideLimit={slideLimitReached(slides.length)}
          />
        </div>

        <Card
          data-enter
          style={motionIndex(2)}
          className="flex min-w-0 flex-col gap-3 bg-glass p-3 backdrop-blur-md lg:col-span-1"
        >
          <div
            ref={stageBoxRef}
            data-editor-stage=""
            tabIndex={0}
            aria-label="Slide canvas — click an element to select, arrows move it"
            className="relative overflow-hidden rounded-nested border border-border bg-muted focus-visible:outline-none"
            onPointerDownCapture={() => {
              /* A fresh press owns the pointer: a gesture whose release was
                 stranded (before capture, or by a lost event) must never leak
                 its offset into this press. */
              if (elementDrag.pointerId !== null) elementDrag.cancel();
              if (transformGesture !== null) {
                setTransformGesture(null);
                setTransformFrame(null);
              }
            }}
            onPointerMove={(event) => {
              if (transformGesture !== null) onTransformMove(event);
              else elementDrag.move(event);
            }}
            onPointerUp={(event) => {
              if (transformGesture !== null) {
                onTransformEnd();
              } else {
                elementDrag.end();
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (transformGesture !== null) onTransformEnd();
              else elementDrag.cancel();
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
          >
            <DeckStage
              deck={localDeck}
              id={presentationId}
              slideIndex={selectedIndex}
              scale="fit-width"
              interactive
            />
            {stageScale !== null ? (
              <div
                className="absolute left-0 top-0"
                style={{
                  width: DECK_STAGE_WIDTH,
                  height: DECK_STAGE_HEIGHT,
                  transform: `scale(${stageScale})`,
                  transformOrigin: "top left",
                  pointerEvents: "none",
                }}
              >
                {hitBoxes.map((box) =>
                  selectedKeys.includes(box.key) ? null : (
                    <button
                      key={box.key}
                      type="button"
                      aria-label={
                        box.type === "text"
                          ? "Select or edit text element"
                          : `Select ${box.type} element`
                      }
                      data-editor-element-hit={box.key}
                      className={`absolute rounded-xs hover:ring-2 hover:ring-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        box.type === "text" ? "cursor-text" : "cursor-move"
                      }`}
                      style={{
                        left: box.x,
                        top: box.y,
                        width: box.width,
                        height: box.height,
                        pointerEvents: "auto",
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        selectFromPointer(box.key, event.shiftKey);
                        /* The capture goes on the stage box (a stable node):
                           the hit target itself unmounts the moment the
                           element becomes selected, and the drag must keep
                           delivering even when the pointer leaves the box. */
                        captureStagePointer(event.pointerId);
                        elementDrag.begin(event);
                      }}
                      onClick={() => {
                        /* A drag that ends on this target must not also enter
                           text editing (the drag hook's `draggedRef` is the
                           synchronous flag). */
                        if (elementDrag.draggedRef.current) {
                          elementDrag.draggedRef.current = false;
                          return;
                        }
                        selectElement(box.key);
                      }}
                    />
                  ),
                )}
                <SelectionLayer
                  scale={stageScale}
                  frames={overlayFrames}
                  selection={selectedKeys}
                  activeKey={activeElementKey}
                  editing={
                    selectedBox !== null && selectedBox.type === "text"
                  }
                  typing={
                    activeElementKey !== null &&
                    inlineFocusKey === activeElementKey
                  }
                  onResizeStart={beginResize}
                  onRotateStart={beginRotate}
                  onDragStart={beginDragFromHandle}
                >
                  {selectedEntry !== null && inlineEditorStyle !== null ? (
                    <InlineRunsEditor
                      key={selectedEntry.key}
                      runs={elementRuns}
                      baseFont={selectedEntry.element.font ?? null}
                      resolveFamily={(family) =>
                        resolveDeckFontFamily(family, deckFonts)
                      }
                      style={inlineEditorStyle}
                      onChange={onElementRunsChange}
                      onSelectionChange={setRunSelection}
                      onToggle={applyRunToggle}
                      onTab={onTabFromEditor}
                      onFocus={() => setInlineFocusKey(selectedEntry.key)}
                      onBlur={(event) => {
                        setInlineFocusKey(null);
                        /* Keep the stage armed only while focus stays inside
                           it (another element, a handle). Moving focus to a
                           chrome control must leave the keyboard to that
                           control: refocusing the stage here made toolbar
                           focus impossible to keep and let arrow/Alt chords
                           fire — and autosave — from the toolbar. */
                        const next = event.relatedTarget as Node | null;
                        const stage = stageBoxRef.current;
                        if (next !== null && stage !== null && stage.contains(next)) {
                          window.requestAnimationFrame(() => stage.focus());
                        }
                      }}
                    />
                  ) : null}
                </SelectionLayer>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <IconButton
                type="button"
                variant="outline"
                size="sm"
                aria-label="Previous slide"
                disabled={selectedIndex <= 0}
                onClick={() => {
                  setSelectedIndex((current) => Math.max(0, current - 1));
                  clearSelection();
                }}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </IconButton>
              <IconButton
                type="button"
                variant="outline"
                size="sm"
                aria-label="Next slide"
                disabled={selectedIndex >= slides.length - 1}
                onClick={() => {
                  setSelectedIndex((current) =>
                    Math.min(slides.length - 1, current + 1),
                  );
                  clearSelection();
                }}
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </IconButton>
              <p
                data-slide-counter=""
                aria-live="polite"
                className="ml-1 font-mono text-label-sm text-muted-foreground"
              >
                {selectedIndex + 1} / {slides.length}
              </p>
              <span
                aria-hidden="true"
                className="mx-1 h-4 w-px bg-border"
              />
              <RunFormatToolbar
                font={toolbarFont}
                enabled={selectedEntry !== null}
                canFormatRuns={canFormatRuns}
                disabledReason={runDisabledReason}
                onPatchFont={applyRunPatch}
                onToggle={(key) => applyRunToggle(key)}
                alignment={
                  selectedEntry?.element.alignment?.horizontal ?? "left"
                }
                onAlignmentChange={onAlignmentChange}
                familyOptions={runFamilyOptions}
                resetKey={`${activeElementKey ?? ""}:${
                  runSelection?.start ?? ""
                }:${runSelection?.end ?? ""}`}
              />
            </div>
            <p className="text-label-sm text-muted-foreground">
              Double-click a text element to edit · select text then Mod+B/I/U
              · drag to move · Alt+J/K reorder · Mod+G group
            </p>
          </div>
        </Card>

        <div
          data-enter
          style={motionIndex(3)}
          className="min-w-0 lg:col-span-2 xl:col-span-1"
        >
          <InspectorPanel
            title={state.title}
            onTitleChange={onTitleChange}
            themeOptions={themeOptions}
            themeValue={themeValue}
            onThemeChange={onThemeChange}
            themeSwatches={theme ? swatchColors(theme) : []}
            notes={notes}
            onNotesChange={onNotesChange}
            layoutOptions={layoutOptions}
            layoutValue={selectedSlide?.layout ?? ""}
            onLayoutChange={onLayoutChange}
            layoutDisabledReason={layoutDisabledReason}
            layoutAddOnlyNote={layoutNote}
            layoutChangeNote={layoutChangeNote}
            blocks={
              structuralEditsEnabled ? (
                <LayoutPalette
                  source="inspector"
                  groups={layoutGroups}
                  atSlideLimit={slideLimitReached(slides.length)}
                  disabledReason={layoutDisabledReason}
                  onAddSlide={onAddSlide}
                  onApplyLayout={applyLayoutToSlide}
                />
              ) : undefined
            }
            elementOptions={textElements.map((entry, index) => {
              const name = entry.element.name?.trim();
              const preview = textOfTextElement(entry.element)
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 28);
              return {
                value: entry.key,
                label: `${index + 1}. ${name && name !== "" ? name : "Text"}${
                  preview !== "" ? ` — ${preview}` : ""
                }`,
              };
            })}
            elementValue={activeElementKey}
            onElementChange={(value) => selectElement(value === "" ? null : value)}
            elementText={
              selectedEntry === null
                ? ""
                : textOfTextElement(selectedEntry.element)
            }
            onElementTextChange={onElementTextChange}
            elementHint={elementHint}
            elementTextRef={elementTextRef}
            imageControls={
              selectedImage !== null ? (
                <ImageControls
                  element={selectedImage}
                  source={imageSource}
                  onOpenPicker={() => setImagePickerOpen(true)}
                  onFitChange={(fit) =>
                    applyImageUpdate("image-fit", (element) =>
                      applyImageFit(element, fit),
                    )
                  }
                  onCropChange={(patch) =>
                    applyImageUpdate("image-crop", (element) =>
                      applyImageCrop(element, patch),
                    )
                  }
                  onBorderRadiusChange={(radius) =>
                    applyImageUpdate("image-border-radius", (element) =>
                      applyImageBorderRadius(element, radius),
                    )
                  }
                  onFlip={(axis) =>
                    applyImageUpdate("image-flip", (element) =>
                      applyImageFlip(element, axis),
                    )
                  }
                  onOpacityChange={(opacity) =>
                    applyImageUpdate("image-opacity", (element) =>
                      applyImageOpacity(element, opacity),
                    )
                  }
                  onOpenIconPicker={
                    selectedImage !== null && selectedImage.is_icon === true
                      ? () => setIconPickerOpen(true)
                      : undefined
                  }
                  onIconColorChange={
                    selectedImage !== null && selectedImage.is_icon === true
                      ? (color) =>
                          applyImageUpdate("icon-color", (element) =>
                            applyIconColor(element, color),
                          )
                      : undefined
                  }
                />
              ) : undefined
            }
            chartControls={
              selectedChart !== null ? (
                <ChartControls
                  element={selectedChart}
                  themeColors={theme?.colors ?? null}
                  onUpdate={(reason, updater) =>
                    applyElementUpdate(reason, (element) =>
                      element.type === "chart" ? updater(element) : element,
                    )
                  }
                />
              ) : undefined
            }
            tableControls={
              selectedTable !== null ? (
                <TableControls
                  element={selectedTable}
                  onUpdate={(reason, updater) =>
                    applyElementUpdate(reason, (element) =>
                      element.type === "table" ? updater(element) : element,
                    )
                  }
                />
              ) : undefined
            }
          />
        </div>
      </div>

      <ImagePickerModal
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        presentationId={presentationId}
        referencedSources={referencedImageSources}
        onSelect={(data) =>
          applyImageUpdate("image-source", (element) =>
            applyImageSource(element, data),
          )
        }
      />

      <IconPickerModal
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        presentationId={presentationId}
        currentSource={
          selectedImage !== null && selectedImage.is_icon === true
            ? selectedImage.data
            : null
        }
        onSelect={(path) =>
          applyImageUpdate("icon-source", (element) =>
            applyIconSource(element, path),
          )
        }
      />
    </div>
  );
}

function swatchColors(theme: DeckTheme): string[] {
  const colors = theme.colors;
  return [
    colors.primary,
    colors.background,
    colors.card,
    colors.stroke,
    colors.background_text,
    colors.primary_text,
    colors.graph_0,
    colors.graph_1,
  ].filter((color) => typeof color === "string" && color.trim() !== "");
}

