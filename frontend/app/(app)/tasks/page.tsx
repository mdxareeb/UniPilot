import { PageHeader } from "@/components/app/PageHeader";
import { Container } from "@/components/ui/Container";
import { listTasks } from "@/lib/data/tasks";
import { getWorkspaceAccess } from "@/lib/onboarding/gate";
import { QuickAddTask } from "./_components/QuickAddTask";
import { TaskBoard } from "./_components/TaskBoard";
import { TasksWorkspace } from "./_components/TasksWorkspace";

/**
 * Tasks (16.1 header; 16.11 real-service binding).
 *
 * The server page owns access and the data read, in that order: the
 * `getWorkspaceAccess` gate runs first (the proxy only refreshes the session,
 * and the Server Actions keep `requireOnboardedUser` as the hard fallback),
 * then `listTasks(user.id)` loads the caller's tasks through the
 * request-scoped, RLS-enforced client. A visitor without a session renders the
 * same header and board with an empty list and no service call at all — the
 * board is real, its copy is honest, and using it opens the sign-in prompt.
 *
 * The mapped `TaskItem[]` is handed to `TasksWorkspace`, the client boundary
 * that owns the live list and every optimistic mutation (16.2/16.6–16.10,
 * 21.9). The header stays the page's own composition — eyebrow, title,
 * description and the `QuickAddTask` trigger — rendered inside the workspace
 * provider so that trigger opens the same dialog stack the board uses.
 */
export default async function TasksPage() {
  const user = await getWorkspaceAccess();
  const tasks = user ? await listTasks(user.id) : [];

  return (
    <Container className="flex min-w-0 flex-col gap-6 py-6 md:gap-8 md:py-8">
      <TasksWorkspace initialTasks={tasks} guest={!user}>
        <PageHeader
          eyebrow="Tasks"
          title="Tasks"
          description={
            user
              ? "Manage your academic workload."
              : "Sign in to manage your academic workload."
          }
          primaryAction={<QuickAddTask />}
        />
        <TaskBoard index={1} />
      </TasksWorkspace>
    </Container>
  );
}
