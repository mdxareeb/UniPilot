/**
 * WhatsApp group sync: the extraction worker's database access.
 *
 * Everything the handler reads or writes goes through this one object so the
 * pipeline logic can be tested with an in-memory fake (see test/memoryRepo.mjs).
 * It uses the worker's service-role client, so EVERY statement re-scopes by
 * `user_id`. Errors are generic: a PostgREST message can echo row content (a
 * student's message), so only a fixed string leaves this module.
 */

class RepoError extends Error {
  constructor(operation) {
    super(`group sync repository failed: ${operation}`);
    this.name = "RepoError";
    this.operation = operation;
    this.retryable = true;
  }
}

const DOCUMENTS_BUCKET = "documents";

function must(result, operation) {
  if (result.error) throw new RepoError(operation);
  return result.data;
}

export function createRepo(client, env = process.env) {
  return {
    async getMessage(id) {
      return must(
        await client
          .from("raw_messages")
          .select(
            "id, user_id, group_jid, whatsapp_msg_id, fingerprint, sender_name, sent_at, raw_text, media_type, file_sha256, status",
          )
          .eq("id", id)
          .maybeSingle(),
        "getMessage",
      );
    },

    async getContext(userId, groupJid) {
      const [profile, connection, subjects, group] = await Promise.all([
        client.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
        client
          .from("integration_connections")
          .select("date_order")
          .eq("user_id", userId)
          .eq("provider", "whatsapp")
          .maybeSingle(),
        client.from("subjects").select("id, name, course_code, aliases").eq("user_id", userId),
        client
          .from("monitored_groups")
          .select("group_name")
          .eq("user_id", userId)
          .eq("group_jid", groupJid)
          .maybeSingle(),
      ]);
      const profileRow = must(profile, "getContext.profile");
      const connectionRow = must(connection, "getContext.connection");
      return {
        timeZone: profileRow?.timezone || env.DEFAULT_TIMEZONE || "UTC",
        dateOrder: (connectionRow?.date_order || env.DATE_ORDER || "DMY") === "MDY" ? "MDY" : "DMY",
        subjects: must(subjects, "getContext.subjects") ?? [],
        groupName: must(group, "getContext.group")?.group_name ?? "",
      };
    },

    async getDocument(messageId) {
      return must(
        await client
          .from("documents")
          .select("id, name, storage_path, mime_type")
          .eq("source_message_id", messageId)
          .maybeSingle(),
        "getDocument",
      );
    },

    async downloadObject(path) {
      const { data, error } = await client.storage.from(DOCUMENTS_BUCKET).download(path);
      if (error || !data) throw new RepoError("downloadObject");
      return new Uint8Array(await data.arrayBuffer());
    },

    async setMessage(id, status, error = null) {
      must(
        await client.from("raw_messages").update({ status, error }).eq("id", id),
        "setMessage",
      );
    },

    async candidateExists(userId, ref) {
      const row = must(
        await client
          .from("integration_candidates")
          .select("id")
          .eq("user_id", userId)
          .eq("fingerprint", ref)
          .maybeSingle(),
        "candidateExists",
      );
      return Boolean(row);
    },

    async insertTask(rec) {
      const rows = must(
        await client
          .from("tasks")
          .upsert(
            {
              user_id: rec.userId,
              title: rec.title,
              description: rec.description,
              status: "todo",
              due_date: rec.dueAt ? rec.dueAt.toISOString() : null,
              subject_id: rec.subjectId,
              source: "whatsapp_group",
              source_ref: rec.ref,
              source_message_id: rec.messageId,
              confidence_score: rec.confidence,
              task_type: rec.taskType,
            },
            { onConflict: "user_id,source,source_ref", ignoreDuplicates: true },
          )
          .select("id"),
        "insertTask",
      );
      return rows && rows.length > 0 ? "inserted" : "duplicate";
    },

    async insertEvent(rec) {
      const rows = must(
        await client
          .from("events")
          .upsert(
            {
              user_id: rec.userId,
              title: rec.title,
              description: rec.description,
              start_at: rec.startAt.toISOString(),
              end_at: rec.endAt ? rec.endAt.toISOString() : null,
              all_day: rec.allDay,
              type: rec.eventType,
              subject_id: rec.subjectId,
              source: "whatsapp_group",
              source_ref: rec.ref,
              source_message_id: rec.messageId,
              confidence_score: rec.confidence,
            },
            { onConflict: "user_id,source,source_ref", ignoreDuplicates: true },
          )
          .select("id"),
        "insertEvent",
      );
      return rows && rows.length > 0 ? "inserted" : "duplicate";
    },

    async insertCandidate(rec) {
      const rows = must(
        await client
          .from("integration_candidates")
          .upsert(
            {
              user_id: rec.userId,
              run_id: null,
              fingerprint: rec.ref,
              title: rec.title,
              start_at: rec.startAt ? rec.startAt.toISOString() : null,
              end_at: rec.endAt ? rec.endAt.toISOString() : null,
              all_day: rec.allDay,
              message_sender: rec.sender,
              message_text: rec.messageText,
              status: "pending",
              origin: "live_group",
              kind: rec.kind,
              event_type: rec.eventType,
              task_type: rec.taskType,
              confidence: rec.confidence,
              subject_id: rec.subjectId,
              proposed_subject_name: rec.proposedSubjectName,
              source_message_id: rec.messageId,
              group_name: rec.groupName || null,
            },
            { onConflict: "user_id,fingerprint", ignoreDuplicates: true },
          )
          .select("id"),
        "insertCandidate",
      );
      return rows && rows.length > 0 ? "inserted" : "duplicate";
    },

    async updateDocument(id, patch) {
      must(await client.from("documents").update(patch).eq("id", id), "updateDocument");
    },

    async deleteDocument(id, path) {
      // Object first: a row without an object is a visible bug, the reverse is
      // an orphan nobody can see.
      await client.storage.from(DOCUMENTS_BUCKET).remove([path]);
      must(await client.from("documents").delete().eq("id", id), "deleteDocument");
    },

    async enqueueIndexing(userId, documentId) {
      must(
        await client
          .from("jobs")
          .insert({ user_id: userId, kind: "document.process", payload: { documentId } }),
        "enqueueIndexing",
      );
    },

    async recordUsage(userId, kind, quantity) {
      must(
        await client.from("usage_events").insert({ user_id: userId, kind, quantity }),
        "recordUsage",
      );
    },
  };
}
