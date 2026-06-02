import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVideoStatusPayload } from "../src/lib/video-status";

test("normalizes legacy video generation payloads into completed video results", () => {
  const normalized = normalizeVideoStatusPayload(
    "task_done",
    {
      code: "success",
      data: {
        task_id: "task_done",
        status: "SUCCESS",
        progress: "100%",
        result_url: "https://file.example/video.mp4"
      }
    },
    200
  );

  assert.equal(normalized.transient, false);
  assert.equal(normalized.statusCode, 200);
  assert.equal(normalized.payload.status, "completed");
  assert.equal(normalized.payload.task_id, "task_done");
  assert.equal(normalized.payload.video_url, "https://file.example/video.mp4");
  assert.equal(normalized.payload.progress, 100);
});
