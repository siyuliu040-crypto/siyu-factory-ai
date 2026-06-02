import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyAccountState,
  listHistoryForUser,
  recordGenerationHistory,
  updateHistoryByTaskId,
  debitCredits,
  grantCredits,
  registerAccount
} from "../src/lib/accounts";

test("first registered account becomes admin and later accounts start as users", () => {
  const state = createEmptyAccountState();

  const owner = registerAccount(state, {
    email: "Owner@Siyu.Factory",
    name: "Owner",
    password: "owner-pass"
  }).user;
  const user = registerAccount(state, {
    email: "creator@example.com",
    name: "Creator",
    password: "creator-pass"
  }).user;

  assert.equal(owner.email, "owner@siyu.factory");
  assert.equal(owner.role, "admin");
  assert.equal(user.role, "user");
  assert.equal(user.credits, 0);
});

test("admin can grant credits and user debits fail when balance is insufficient", () => {
  const state = createEmptyAccountState();
  const owner = registerAccount(state, {
    email: "owner@siyu.factory",
    name: "Owner",
    password: "owner-pass"
  }).user;
  const user = registerAccount(state, {
    email: "creator@example.com",
    name: "Creator",
    password: "creator-pass"
  }).user;

  grantCredits(state, {
    adminId: owner.id,
    userId: user.id,
    amount: 1_200_000,
    reason: "starter package"
  });

  assert.equal(state.users.find((item) => item.id === user.id)?.credits, 1_200_000);

  debitCredits(state, {
    userId: user.id,
    amount: 400_000,
    reason: "image generation"
  });

  assert.equal(state.users.find((item) => item.id === user.id)?.credits, 800_000);
  assert.throws(
    () =>
      debitCredits(state, {
        userId: user.id,
        amount: 900_000,
        reason: "video generation"
      }),
    (error) => error instanceof Error && "code" in error && error.code === "insufficient_credits"
  );
});

test("generation history is stored per user and can be updated by task id", () => {
  const state = createEmptyAccountState();
  const user = registerAccount(state, {
    email: "creator@example.com",
    name: "Creator",
    password: "creator-pass"
  }).user;

  recordGenerationHistory(state, {
    userId: user.id,
    type: "video",
    model: "ali-sora-video-portrait-official-4s",
    prompt: "short wig product video",
    taskId: "task_video",
    status: "queued"
  });

  updateHistoryByTaskId(state, "task_video", {
    status: "completed",
    previewUrl: "https://file.example/video.mp4"
  });

  const history = listHistoryForUser(state, user.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].previewUrl, "https://file.example/video.mp4");
});
