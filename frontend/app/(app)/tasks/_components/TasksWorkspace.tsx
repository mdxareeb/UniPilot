"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSignInPrompt } from "@/components/auth/SignInPromptProvider";
import {
  createTaskAction,
  deleteTaskAction,
  getTaskAction,
  setTaskStatusAction,
  updateTaskAction,
} from "@/lib/data/taskActions";
import { TASK_DELETE_ERROR, TASK_SAVE_ERROR } from "@/lib/data/taskErrors";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  toTaskStatus,
  type TaskItem,
  type TaskPriority,
  type TaskUiStatus,
} from "@/lib/data/taskValues";
import { TaskDeleteModal } from "./TaskDeleteModal";
import { TaskDetailModal } from "./TaskDetailModal";
import { TaskFormModal } from "./TaskFormModal";

/** What either form (create or edit) collects. Priority "none" clears. */
export type TaskFormValues = {
  title: string;
  /** "YYYY-MM-DD" from the native date input, or null when empty. */
  dueDate: string | null;
  priority: "none" | TaskPriority;
};

type DetailState =
  | { status: "idle"; task: null }
  | { status: "loading"; task: null }
  | { status: "found"; task: TaskItem }
  | { status: "missing"; task: null };

type TasksContextValue = {
  tasks: TaskItem[];
  /** True for the guest render: the board is real, every action prompts. */
  guest: boolean;
  /** Sanitized failure for board-level operations (move/refresh). */
  error: string | null;
  /** Polite live-region text (16.9's keyboard move announcements). */
  announcement: string;
  clearError: () => void;
  openCreate: () => void;
  openEdit: (task: TaskItem) => void;
  requestDelete: (task: TaskItem) => void;
  openDetail: (taskId: string) => void;
  /** All resolve to the sanitized error, or null on success. */
  create: (values: TaskFormValues) => Promise<string | null>;
  update: (id: string, values: TaskFormValues) => Promise<string | null>;
  remove: (id: string) => Promise<string | null>;
  /** Optimistic column move with rollback; no return — it owns its error. */
  move: (task: TaskItem, status: TaskUiStatus) => void;
  detail: {
    id: string | null;
    status: DetailState["status"];
    task: TaskItem | null;
  };
  closeDetail: () => void;
};

const TasksContext = createContext<TasksContextValue | null>(null);

export function useTasks(): TasksContextValue {
  const value = useContext(TasksContext);
  if (!value) {
    throw new Error("useTasks must be used inside TasksWorkspace.");
  }
  return value;
}

/** Sentinel that keeps undated tasks last in the client-side order. */
const UNDATED_KEY = "9999-99-99";

/**
 * The client work order: soonest due date first, undated last, then the order
 * the list already had (which is the service's created_at order, with
 * optimistic rows appended). Mirrors `listTasks`' deterministic ordering
 * closely enough that an optimistic insert/edit lands where the reload will
 * put it.
 */
function sortTasks(list: TaskItem[]): TaskItem[] {
  return list
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const aKey = a.task.dueDateValue ?? UNDATED_KEY;
      const bKey = b.task.dueDateValue ?? UNDATED_KEY;
      if (aKey !== bKey) return aKey < bKey ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

function onOptimisticResult(result: {
  error: string | null;
  task: TaskItem | null;
}): string | null {
  return result.error ?? (result.task ? null : TASK_SAVE_ERROR);
}

/**
 * The tasks workspace (16.11 binding + 21.9's UI half): the client boundary
 * that owns the task list the server page loaded and every mutation the board
 * performs.
 *
 * The page stays the server owner of access and data (`getWorkspaceAccess` →
 * `listTasks`) and passes the initial list here; this component is what makes
 * the optimistic paths possible. Every mutation applies its change to the
 * local list first, calls the existing Server Action, then either reconciles
 * with the settled row the action returns or rolls the snapshot back and
 * surfaces the sanitized error — the two halves of the 21.9 contract.
 *
 * For a guest the list is empty, the detail resolver is skipped entirely (no
 * Server Action runs on `?task=`), and every entry point — create, edit,
 * delete, move — calls `requireAuth` first and opens the skippable sign-in
 * prompt instead of reaching an action. The board itself is the real board:
 * three honest columns with guest copy, nothing fabricated.
 *
 * The header and the board are the page's children, rendered inside this
 * provider so the "New task" trigger in the header opens the same modal stack
 * the board's cards do: one workspace state, no prop drilling and no second
 * source of truth. All dialogs are the shared `Modal` primitive.
 */
export function TasksWorkspace({
  initialTasks,
  guest,
  children,
}: {
  initialTasks: TaskItem[];
  guest: boolean;
  children: ReactNode;
}) {
  const { openPrompt, requireAuth } = useSignInPrompt();
  /**
   * The guest guard every entry point uses. The server already told this
   * component whether the caller is a guest, so that verdict wins over the
   * streamed context flag — a guest's first click can never race hydration.
   * The context fallback (`requireAuth`) covers any future mount that lacks
   * the prop, and lets an authenticated visitor through untouched.
   */
  const guard = useCallback(
    (reason: string): boolean => {
      if (guest) {
        openPrompt(reason);
        return false;
      }
      return requireAuth(reason);
    },
    [guest, openPrompt, requireAuth],
  );
  const [tasks, setTasks] = useState<TaskItem[]>(() => sortTasks(initialTasks));
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TaskItem | null>(null);
  const [deleting, setDeleting] = useState<TaskItem | null>(null);
  /* Open-session counters: each dialog body is keyed by these so it remounts
     fresh per open instead of resetting through an effect. */
  const [formKey, setFormKey] = useState(0);
  const [deleteKey, setDeleteKey] = useState(0);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const detailId = searchParams.get("task");
  const [resolvedDetail, setResolvedDetail] = useState<{
    id: string;
    state: DetailState;
  } | null>(null);

  /* 16.10: the detail modal is URL-driven (`?task=<id>`) and resolves the id
     through the Server Action, so a fabricated, altered or foreign id answers
     "not found" — ownership is the server's, never the URL's. The effect only
     writes state from the async result; "loading" is derived below, so no
     synchronous setState runs in the effect body. A guest never resolves:
     skipping the action here is what keeps the guest render free of any data
     read. */
  useEffect(() => {
    if (guest || !detailId) return;

    let cancelled = false;

    getTaskAction(detailId)
      .then((result) => {
        if (cancelled) return;
        setResolvedDetail({
          id: detailId,
          state: result.task
            ? { status: "found", task: result.task }
            : { status: "missing", task: null },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedDetail({ id: detailId, state: { status: "missing", task: null } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailId, guest]);

  const detail: DetailState =
    guest || detailId === null
      ? { status: "idle", task: null }
      : resolvedDetail?.id === detailId
        ? resolvedDetail.state
        : { status: "loading", task: null };

  const clearError = useCallback(() => setError(null), []);

  /**
   * One in-flight status move per task, plus a version per task. Presses
   * update the card optimistically and immediately; their Server Actions run
   * in order, and a result is only reconciled when it belongs to the newest
   * press — so two fast keyboard moves end at the second column and an older
   * response can never clobber a newer one. */
  const moveState = useRef<{
    versions: Map<string, number>;
    queues: Map<string, Promise<void>>;
  }>({ versions: new Map(), queues: new Map() });

  const openCreate = useCallback(() => {
    if (!guard("Sign in to add tasks to your board.")) return;
    setFormKey((key) => key + 1);
    setCreateOpen(true);
  }, [guard]);

  const openEdit = useCallback(
    (task: TaskItem) => {
      if (!guard("Sign in to edit your tasks.")) return;
      setFormKey((key) => key + 1);
      setEditing(task);
    },
    [guard],
  );

  const requestDelete = useCallback(
    (task: TaskItem) => {
      if (!guard("Sign in to delete your tasks.")) return;
      setDeleteKey((key) => key + 1);
      setDeleting(task);
    },
    [guard],
  );

  const create = useCallback(
    async (values: TaskFormValues): Promise<string | null> => {
      // Never reach an action for a guest: the prompt is the whole outcome.
      if (!guard("Sign in to add tasks to your board.")) return null;

      const tempId = `pending-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const priority = values.priority === "none" ? undefined : values.priority;

      // Optimistic: the card exists before the write does; the settled row
      // replaces it, a failure removes it again.
      const optimistic: TaskItem = {
        id: tempId,
        title: values.title,
        status: "todo",
        dueDateValue: values.dueDate ?? undefined,
        priorityValue: priority,
        priority: priority ? TASK_PRIORITY_LABELS[priority] : undefined,
      };
      setTasks((prev) => sortTasks([...prev, optimistic]));

      let result: Awaited<ReturnType<typeof createTaskAction>>;
      try {
        result = await createTaskAction({
          title: values.title,
          dueDate: values.dueDate,
          priority: values.priority,
        });
      } catch {
        result = { error: TASK_SAVE_ERROR, task: null };
      }

      const failure = onOptimisticResult(result);
      if (failure) {
        setTasks((prev) => prev.filter((task) => task.id !== tempId));
        return failure;
      }

      setTasks((prev) =>
        sortTasks(
          prev.map((task) => (task.id === tempId ? result.task! : task)),
        ),
      );
      return null;
    },
    [guard],
  );

  const update = useCallback(
    async (id: string, values: TaskFormValues): Promise<string | null> => {
      if (!guard("Sign in to edit your tasks.")) return null;

      const previous = tasks.find((task) => task.id === id);
      if (!previous) return TASK_SAVE_ERROR;

      const priority = values.priority === "none" ? undefined : values.priority;
      // Optimistic title/priority/date-key update; the display date string
      // reconciles with the settled row a moment later.
      const optimistic: TaskItem = {
        ...previous,
        title: values.title,
        priorityValue: priority,
        priority: priority ? TASK_PRIORITY_LABELS[priority] : undefined,
        dueDateValue: values.dueDate ?? undefined,
      };
      setTasks((prev) =>
        sortTasks(prev.map((task) => (task.id === id ? optimistic : task))),
      );

      let result: Awaited<ReturnType<typeof updateTaskAction>>;
      try {
        result = await updateTaskAction(id, {
          title: values.title,
          dueDate: values.dueDate,
          priority: values.priority,
        });
      } catch {
        result = { error: TASK_SAVE_ERROR, task: null };
      }

      const failure = onOptimisticResult(result);
      if (failure) {
        setTasks((prev) =>
          sortTasks(prev.map((task) => (task.id === id ? previous : task))),
        );
        return failure;
      }

      setTasks((prev) =>
        sortTasks(
          prev.map((task) => (task.id === id ? result.task! : task)),
        ),
      );
      return null;
    },
    [tasks, guard],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      if (!guard("Sign in to delete your tasks.")) return null;

      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1) return TASK_DELETE_ERROR;
      const previous = tasks[index];

      // Optimistic removal; a failure re-inserts at the exact position.
      setTasks((prev) => prev.filter((task) => task.id !== id));

      let result: Awaited<ReturnType<typeof deleteTaskAction>>;
      try {
        result = await deleteTaskAction(id);
      } catch {
        result = { error: TASK_DELETE_ERROR };
      }

      if (result.error) {
        setTasks((prev) => {
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, previous);
          return sortTasks(next);
        });
        return result.error;
      }
      return null;
    },
    [tasks, guard],
  );

  const move = useCallback((task: TaskItem, status: TaskUiStatus) => {
    if (!guard("Sign in to move tasks between columns.")) return;
    if (task.status === status) return;
    const previousStatus = task.status;
    const taskId = task.id;

    const version =
      (moveState.current.versions.get(taskId) ?? 0) + 1;
    moveState.current.versions.set(taskId, version);

    setTasks((prev) =>
      sortTasks(
        prev.map((item) => (item.id === taskId ? { ...item, status } : item)),
      ),
    );
    setAnnouncement(`Moved “${task.title}” to ${TASK_STATUS_LABELS[status]}.`);

    const run = async () => {
      let result: Awaited<ReturnType<typeof setTaskStatusAction>>;
      try {
        result = await setTaskStatusAction(taskId, toTaskStatus(status));
      } catch {
        result = { error: TASK_SAVE_ERROR, task: null };
      }

      // A newer press supersedes this result; that press owns the state now.
      if (moveState.current.versions.get(taskId) !== version) return;

      const failure = onOptimisticResult(result);
      if (failure) {
        setTasks((prev) =>
          prev.map((item) =>
            item.id === taskId && item.status === status
              ? { ...item, status: previousStatus }
              : item,
          ),
        );
        setError(failure);
        return;
      }

      setTasks((prev) =>
        prev.map((item) => (item.id === taskId ? result.task! : item)),
      );
    };

    const queued = (
      moveState.current.queues.get(taskId) ?? Promise.resolve()
    ).then(run, run);
    moveState.current.queues.set(taskId, queued);
  }, [guard]);

  const openDetail = useCallback(
    (taskId: string) => {
      router.push(`${pathname}?task=${taskId}`, { scroll: false });
    },
    [pathname, router],
  );

  const closeDetail = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  /* Prefer the live item so an edit made from the detail modal is reflected
     immediately; fall back to the resolved snapshot. */
  const detailTask = useMemo(() => {
    if (!detail.task) return null;
    return tasks.find((task) => task.id === detail.task!.id) ?? detail.task;
  }, [detail.task, tasks]);

  const value = useMemo<TasksContextValue>(
    () => ({
      tasks,
      guest,
      error,
      announcement,
      clearError,
      openCreate,
      openEdit,
      requestDelete,
      openDetail,
      create,
      update,
      remove,
      move,
      detail: { id: detailId, status: detail.status, task: detailTask },
      closeDetail,
    }),
    [
      tasks,
      guest,
      error,
      announcement,
      clearError,
      openCreate,
      openEdit,
      requestDelete,
      openDetail,
      create,
      update,
      remove,
      move,
      detailId,
      detail.status,
      detailTask,
      closeDetail,
    ],
  );

  return (
    <TasksContext.Provider value={value}>
      {children}

      <TaskFormModal
        mode="create"
        open={createOpen}
        task={null}
        formKey={formKey}
        onClose={() => setCreateOpen(false)}
      />
      <TaskFormModal
        mode="edit"
        open={editing !== null}
        task={editing}
        formKey={formKey}
        onClose={() => setEditing(null)}
      />
      <TaskDeleteModal
        task={deleting}
        bodyKey={deleteKey}
        onClose={() => setDeleting(null)}
      />
      <TaskDetailModal
        state={detail.status}
        task={detailTask}
        onClose={closeDetail}
        onEdit={(task) => {
          closeDetail();
          openEdit(task);
        }}
        onDelete={(task) => {
          closeDetail();
          requestDelete(task);
        }}
      />
    </TasksContext.Provider>
  );
}
