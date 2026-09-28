export function createOpenCodeHttpClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  const origin = new URL(baseUrl)
  if (!new Set(["http:", "https:"]).has(origin.protocol)) throw new TypeError("OpenCode server URL must use HTTP(S)")
  if (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost" && origin.hostname !== "[::1]") {
    throw new Error("isolated driver only permits a loopback OpenCode server")
  }

  const url = (path, directory) => {
    const target = new URL(path, origin)
    if (directory !== undefined) target.searchParams.set("directory", directory)
    return target
  }

  async function jsonRequest(path, { method = "GET", directory, body, signal } = {}) {
    const response = await fetchImpl(url(path, directory), {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new OpenCodeHttpError(method, path, response.status)
    if (response.status === 204) return undefined
    try { return await response.json() }
    catch { throw new OpenCodeHttpError(method, path, response.status, "invalid_json") }
  }

  return {
    session: {
      create: async (request, options = {}) => ({
        data: await jsonRequest("/session", { method: "POST", directory: request.query.directory, body: request.body, signal: options.signal }),
      }),
      prompt: async (request, options = {}) => ({
        data: await jsonRequest(`/session/${encodeURIComponent(request.path.id)}/message`, {
          method: "POST",
          directory: request.query.directory,
          body: request.body,
          signal: options.signal,
        }),
      }),
      abort: async (sessionId, directory, options = {}) => {
        await jsonRequest(`/session/${encodeURIComponent(sessionId)}/abort`, { method: "POST", directory, body: {}, signal: options.signal })
        return true
      },
      delete: async (sessionId, directory, options = {}) => {
        await jsonRequest(`/session/${encodeURIComponent(sessionId)}`, { method: "DELETE", directory, signal: options.signal })
        return true
      },
    },
    health: (options = {}) => jsonRequest("/global/health", { signal: options.signal }),
    eventStream: (options = {}) => fetchImpl(url("/global/event"), {
      headers: { accept: "text/event-stream" },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  }
}

export class OpenCodeHttpError extends Error {
  constructor(method, path, status, code = "http_error") {
    super(`OpenCode ${method} ${path} failed (${status}; ${code})`)
    this.name = "OpenCodeHttpError"
    this.code = code
    this.status = status
  }
}

/** Subscribe before prompts; any stream loss makes attempt counts non-exact. */
export function startRetryEventMonitor({ client, onRetry }) {
  const controller = new AbortController()
  const state = { ready: false, healthy: false, closed: false, error: null, retry_events: 0 }
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })

  const task = (async () => {
    try {
      const response = await client.eventStream({ signal: controller.signal })
      if (!response.ok || !response.body) throw new OpenCodeHttpError("GET", "/global/event", response.status, "event_stream_unavailable")
      state.ready = true
      state.healthy = true
      resolveReady()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let separator
        while ((separator = /\r?\n\r?\n/u.exec(buffer)) !== null) {
          const frame = buffer.slice(0, separator.index)
          buffer = buffer.slice(separator.index + separator[0].length)
          const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
          if (!data) continue
          let event
          try { event = JSON.parse(data) } catch { continue }
          const payload = event?.payload
          const props = payload?.properties
          if (payload?.type !== "session.status" || props?.status?.type !== "retry") continue
          if (typeof props.sessionID !== "string" || !Number.isInteger(props.status.attempt)) continue
          state.retry_events += 1
          onRetry({ sessionId: props.sessionID, attempt: props.status.attempt })
        }
      }
      if (!controller.signal.aborted) {
        state.healthy = false
        state.error = "event_stream_closed"
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        state.healthy = false
        state.error = errorRecord(error)
        if (!state.ready) rejectReady(error)
      }
    } finally {
      state.closed = true
    }
  })()

  return {
    state,
    ready,
    async stop() {
      controller.abort()
      await task
    },
  }
}

function errorRecord(error) {
  return { name: error?.name ?? "Error", message: error?.message ?? String(error), code: error?.code ?? null }
}
