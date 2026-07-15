import { createClient } from "jsr:@supabase/supabase-js@2";

type StageResponse = {
  job_id: string;
  topic_id: string;
  manifest: {
    job: {
      topic_id: string;
      template_id: string;
      target_group_id: string;
      target_course_id: string;
      target_module_id: string;
      available_from: string | null;
      order_index: number;
    };
    template: {
      id: string;
      title: string;
      subject: string;
      exam_type: string | null;
      description: string | null;
    };
    materials: Array<{
      template_material_id: string;
      type: string;
      content: string | null;
      file_path: string | null;
      link_url: string | null;
      sort_order: number;
      target_file_path: string | null;
    }>;
    tasks: Array<{
      template_task_id: string;
      task_kind: string;
      catalog_task_id: string | null;
      title: string | null;
      payload: Record<string, unknown>;
      sort_order: number;
    }>;
  };
};

type MaterialFinalizeRow = {
  template_material_id: string;
  type: string;
  content: string | null;
  target_file_path: string | null;
  link_url: string | null;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "MISSING_AUTH_HEADER" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let staged: StageResponse | null = null;
  const copiedObjectPaths: string[] = [];

  try {
    const body = await req.json();
    const {
      template_id,
      target_group_id,
      target_course_id,
      target_module_id,
      available_from = null,
      order_index = null,
      fail_after_objects = null, // optional test hook; remove in prod if unwanted
    } = body ?? {};

    const { data: stageData, error: stageError } = await userClient.rpc("stage_lesson_copy", {
      p_template_id: template_id,
      p_target_group_id: target_group_id,
      p_target_course_id: target_course_id,
      p_target_module_id: target_module_id,
      p_available_from: available_from,
      p_order_index: order_index,
    });

    if (stageError) {
      return json({ error: stageError.message }, 400);
    }

    staged = stageData as StageResponse;

    const finalizeRows: MaterialFinalizeRow[] = [];

    let copiedCount = 0;
    for (const material of staged.manifest.materials ?? []) {
      if (!material.file_path || !material.target_file_path) {
        finalizeRows.push({
          template_material_id: material.template_material_id,
          type: material.type,
          content: material.content,
          target_file_path: material.target_file_path,
          link_url: material.link_url,
        });
        continue;
      }

      const sourceBucket = "lesson-library";
      const targetBucket = "course-materials";

      const { data: downloadData, error: downloadError } = await serviceClient.storage
        .from(sourceBucket)
        .download(material.file_path);

      if (downloadError || !downloadData) {
        throw new Error(`STORAGE_SOURCE_READ_FAILED:${material.file_path}:${downloadError?.message ?? "unknown"}`);
      }

      const { data: infoData } = await serviceClient.storage.from(sourceBucket).info(material.file_path);

      const uploadOptions: {
        contentType?: string;
        upsert: boolean;
        metadata?: Record<string, string>;
      } = {
        upsert: false,
      };

      if (infoData?.metadata?.mimetype) {
        uploadOptions.contentType = infoData.metadata.mimetype;
      }

      // For .link marker copies, preserve metadata payload.
      if (material.type === "link" && infoData?.metadata) {
        uploadOptions.metadata = { ...infoData.metadata };
      }

      const { error: uploadError } = await serviceClient.storage
        .from(targetBucket)
        .upload(material.target_file_path, downloadData, uploadOptions);

      if (uploadError) {
        throw new Error(`STORAGE_TARGET_WRITE_FAILED:${material.target_file_path}:${uploadError.message}`);
      }

      copiedObjectPaths.push(material.target_file_path);
      copiedCount += 1;

      if (fail_after_objects !== null && copiedCount >= Number(fail_after_objects)) {
        throw new Error("TEST_FORCED_STORAGE_FAILURE");
      }

      finalizeRows.push({
        template_material_id: material.template_material_id,
        type: material.type,
        content: material.content,
        target_file_path: material.target_file_path,
        link_url: material.link_url,
      });
    }

    const { data: finalizeData, error: finalizeError } = await userClient.rpc("finalize_lesson_copy", {
      p_job_id: staged.job_id,
      p_material_results: finalizeRows,
    });

    if (finalizeError) {
      throw new Error(`FINALIZE_FAILED:${finalizeError.message}`);
    }

    return json({
      ok: true,
      job_id: staged.job_id,
      topic_id: finalizeData?.topic_id ?? staged.topic_id,
      copied_material_count: finalizeRows.length,
      copied_storage_object_count: copiedObjectPaths.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_COPY_ERROR";

    // 1. Best-effort cleanup storage objects already copied to target
    if (copiedObjectPaths.length > 0) {
      try {
        await serviceClient.storage.from("course-materials").remove(copiedObjectPaths);
      } catch {
        // suppress; DB rollback still must run
      }
    }

    // 2. Best-effort rollback DB rows
    if (staged?.job_id) {
      try {
        await userClientFromAuthHeader(authHeader).rpc("rollback_lesson_copy", {
          p_job_id: staged.job_id,
        });
      } catch {
        // suppress; response still returns error
      }
    }

    return json(
      {
        ok: false,
        error: message,
        rolled_back: !!staged?.job_id,
      },
      400,
    );
  }
});

function userClientFromAuthHeader(authHeader: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
