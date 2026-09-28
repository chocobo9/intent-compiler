import test from "node:test"
import assert from "node:assert/strict"
import { runBudgetedBatch } from "./batch-controller.mjs"

test("a completed management prompt records one logical request and one provider attempt", async () => {
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      batch.sessionCreated("proposal-session")
      return batch.prompt({
        sessionId: "proposal-session",
        kind: "proposal",
        model: "openai/gpt-6-luna-fast",
        variant: "max",
        invoke: async () => ({ info: { providerID: "openai", modelID: "gpt-6-luna-fast", tokens: { input: 12, output: 4 } } }),
      })
    },
  })

  assert.equal(result.status, "completed")
  assert.equal(result.logical_request_count, 1)
  assert.equal(result.provider_attempt_count, 1)
  assert.equal(result.requests[0].provider_attempt_count_exact, true)
})

test("a retryable provider error inside one OpenCode prompt is a separate provider attempt", async () => {
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      batch.sessionCreated("proposal-session")
      return batch.prompt({
        sessionId: "proposal-session",
        kind: "proposal",
        model: "openai/gpt-6-luna-fast",
        variant: "max",
        invoke: async ({ retryObserved }) => {
          // Simulate OpenCode swallowing a retryable provider error and retrying
          // inside the same session.prompt HTTP request.
          let providerAttempt = 1
          try { throw Object.assign(new Error("temporary 503"), { retryable: true }) }
          catch (error) {
            assert.equal(error.retryable, true)
            retryObserved({ sessionId: "proposal-session", attempt: providerAttempt })
            providerAttempt += 1
          }
          assert.equal(providerAttempt, 2)
          return { info: { providerID: "openai", modelID: "gpt-6-luna-fast", tokens: { input: 12, output: 4 } } }
        },
      })
    },
  })

  assert.equal(result.status, "completed")
  assert.equal(result.logical_request_count, 1)
  assert.equal(result.provider_attempt_count, 2)
  assert.deepEqual(result.requests[0].retry_attempts, [1])
})

test("the fourth logical model prompt is blocked before invoking OpenCode", async () => {
  let invoked = 0
  const result = await runBudgetedBatch({
    deadlineMs: 500,
    maxLogicalRequests: 3,
    run: async (batch) => {
      for (let index = 0; index < 4; index += 1) {
        const sessionId = `session-${index + 1}`
        batch.sessionCreated(sessionId)
        try {
          await batch.prompt({
            sessionId,
            kind: "proposal",
            model: "openai/gpt-6-luna-fast",
            variant: "max",
            invoke: async () => { invoked += 1; return { info: { tokens: {} } } },
          })
        } catch (error) {
          if (index !== 3) throw error
        }
      }
    },
  })
  assert.equal(result.status, "request_limit_exceeded")
  assert.equal(result.logical_request_count, 3)
  assert.equal(invoked, 3)
  assert.equal(result.request_limit_exceeded, true)
})

test("deadline aborts active OpenCode sessions and settles the prompt before returning", async () => {
  const stopReasons = []
  const result = await runBudgetedBatch({
    deadlineMs: 30,
    maxLogicalRequests: 3,
    cancelGraceMs: 100,
    abortSession: async (sessionId) => {
      assert.equal(sessionId, "proposal-session")
      stopReasons.push("session.abort")
      return true
    },
    terminateServer: async () => {
      stopReasons.push("server.kill")
      return { exited: true }
    },
    run: async (batch) => {
      batch.sessionCreated("proposal-session")
      return batch.prompt({
        sessionId: "proposal-session",
        kind: "proposal",
        model: "openai/gpt-6-luna-fast",
        variant: "max",
        invoke: ({ signal }) => new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("client request aborted")), { once: true })
        }),
      })
    },
  })

  assert.equal(result.status, "deadline_exceeded")
  assert.deepEqual(stopReasons, ["session.abort", "server.kill"])
  assert.equal(result.pending_prompt_count_at_return, 0)
  assert.equal(result.no_new_prompts_after_deadline, true)
  assert.equal(result.cleanup_confirmed, true)
  assert.equal(result.host_terminated, true)
  assert.equal(result.session_aborts_confirmed, true)
  assert.equal(result.provider_attempt_count, null)
})

test("an unconfirmed session abort terminates the dedicated server before returning", async () => {
  let hostTerminated = false
  const result = await runBudgetedBatch({
    deadlineMs: 30,
    maxLogicalRequests: 3,
    cancelGraceMs: 20,
    abortSession: async () => true,
    terminateServer: async () => {
      hostTerminated = true
      return { exited: true }
    },
    run: async (batch) => {
      batch.sessionCreated("stuck-session")
      return batch.prompt({
        sessionId: "stuck-session",
        kind: "check",
        model: "openai/gpt-6-luna-fast",
        variant: "max",
        invoke: ({ signal, hostTerminated: hostSignal }) => new Promise((resolve, reject) => {
          hostSignal.addEventListener("abort", () => reject(new Error("server stopped")), { once: true })
          signal.addEventListener("abort", () => {}, { once: true })
        }),
      })
    },
  })

  assert.equal(result.status, "deadline_exceeded")
  assert.equal(hostTerminated, true)
  assert.equal(result.host_terminated, true)
  assert.equal(result.pending_prompt_count_at_return, 0)
  assert.equal(result.cleanup_confirmed, true)
})
