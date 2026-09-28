export function createBudgetedOpenCodeClient({ batch, client, onOperation = () => {}, retryEventsAvailable = () => true }) {
  if (!batch || !client?.session?.create || !client?.session?.prompt) throw new TypeError("budgeted OpenCode client requires batch and session methods")

  return {
    session: {
      async create(request) {
        batch.assertCanStartRequest()
        const started = performance.now()
        const response = await batch.hostOperation({
          name: "session.create",
          invoke: ({ signal }) => client.session.create(request, { signal }),
        })
        const sessionId = response?.data?.id ?? response?.id
        onOperation({ operation: "session.create", status: "completed", elapsed_ms: Math.round(performance.now() - started), session_id: sessionId ?? null })
        return response
      },
      async prompt(request) {
        if (!retryEventsAvailable()) throw new Error("retry-event observer is unavailable; refusing another OpenCode model prompt")
        validateModelRequest(request)
        const kind = request.body.system.includes("independent check") ? "check" : "proposal"
        const schemaId = request.body.format?.schema?.$id ?? null
        const started = performance.now()
        return batch.prompt({
          sessionId: request.path.id,
          kind,
          model: `${request.body.model.providerID}/${request.body.model.modelID}`,
          variant: request.body.variant,
          invoke: async ({ signal }) => {
            onOperation({ operation: "session.prompt", status: "started", session_id: request.path.id, kind, model: `${request.body.model.providerID}/${request.body.model.modelID}`, schema_id: schemaId })
            try {
              const response = await client.session.prompt(request, { signal })
              onOperation({ operation: "session.prompt", status: "completed", session_id: request.path.id, kind, elapsed_ms: Math.round(performance.now() - started) })
              return response?.data ?? response
            } catch (error) {
              onOperation({ operation: "session.prompt", status: "failed", session_id: request.path.id, kind, elapsed_ms: Math.round(performance.now() - started), error: errorRecord(error) })
              throw error
            }
          },
        })
      },
    },
  }
}

function validateModelRequest(request) {
  const body = request?.body
  if (body?.model?.providerID !== "openai" || body?.model?.modelID !== "gpt-6-luna-fast" || body?.variant !== "max") {
    throw new Error("OpenCode driver refused a prompt outside openai/gpt-6-luna-fast (max)")
  }
  if (body?.tools?.["*"] !== false) throw new Error("OpenCode driver refused a prompt that does not disable all tools")
  if (body?.format?.type !== "json_schema" || body?.format?.retryCount !== 0 || !body.format.schema) {
    throw new Error("OpenCode driver requires the compiler JSON Schema with structured-output retries disabled")
  }
  if (typeof body.system !== "string" || !body.system.includes("Intent Compiler")) {
    throw new Error("OpenCode driver refused an unrecognized compiler prompt")
  }
}

function errorRecord(error) {
  return { name: error?.name ?? "Error", code: error?.code ?? null, message: error?.message ?? String(error) }
}
