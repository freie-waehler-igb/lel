const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const express = require("express")
const { converse, withUsage, tokensSent } = require("./llm")
const { createSemanticCache } = require("./semantic-cache")
const chatCache = createSemanticCache()
const { readFile } = require("./readfile")
const { normalizeFilters, hasAnchor, hasConstraint } = require("./schema")
const { resolveTurn } = require("./turn")
const { searchJobs } = require("./search")
const { log, since, end, bind } = require("./log")

const HEADERS = {
  "X-API-Key": "jobboerse-jobsuche",
  Accept: "application/json",
  "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse)"
}

const app = express()
app.use(express.json({ limit: "1mb" }))

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content.trim() }))
}

app.get("/api/health", async (_request, response) => {
  const nvidiaKey = Boolean(process.env.NVIDIA_API_KEY)
  let agency = "down"
  try {
    const result = await fetch(
      "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs?size=1&page=1&angebotsart=1",
      { headers: HEADERS, signal: AbortSignal.timeout(8000) }
    )
    if (result.ok) agency = "ok"
  } catch {
    agency = "down"
  }
  response.json({ nvidiaKey, agency })
})

function clip(text) {
  const line = String(text).replace(/\s+/g, " ").trim()
  return line.length > 180 ? line.slice(0, 180) + "…" : line
}

app.post("/api/chat", async (request, response) => {
  const messages = cleanMessages(request.body?.messages)
  const last = messages[messages.length - 1]
  if (!last || last.role !== "user") {
    response.status(400).json({ error: "Die letzte Nachricht fehlt." })
    return
  }
  if (last.content.length > 12000) {
    response.status(400).json({ error: "Die Nachricht ist zu lang." })
    return
  }

  try {
    await bind(() => withUsage(async () => {
      const users = messages.filter((message) => message.role === "user")
      const previous = normalizeFilters(request.body?.filters ?? null)
      const cacheKey = {
        cacheText: last.content + "\n" + [previous.roles.join(","), previous.locations.join(","), previous.radiusKm || "", previous.remote].join("|"),
        context: users.length > 1 ? users.at(-2).content : ""
      }
      const cachedChat = await chatCache.find(cacheKey)
      if (cachedChat) {
        log("Cache-Treffer")
        response.json({ ...cachedChat, tokensSent: 0, cached: true })
        return
      }
      let reply
      try {
        reply = await converse(messages, previous)
      } catch (error) {
        console.error("Chat:", error.message)
        response.json({
          assistantMessage: "Da hakelt es gerade bei mir. Sag mir einfach nochmal, wonach du suchen willst.",
          filters: previous,
          extracted: { ready: false, readyToSearch: false, jobTitle: [], location: "", radius: null, remote: null, hybrid: null, skills: [], clauses: [] },
          options: [],
          ready: false,
          safety: null,
          searched: false,
          provider: "nemotron",
          tokensSent: tokensSent()
        })
        return
      }
      const plan = resolveTurn(reply, last.content, previous)
      log((plan.ready ? "Suche ist bereit" : "Noch keine Suche") + "\n" + clip(last.content))
      const payload = {
        assistantMessage: plan.assistantMessage,
        filters: plan.filters,
        extracted: plan.extracted,
        options: [],
        ready: plan.ready,
        safety: null,
        searched: false,
        provider: reply.provider || "nemotron",
        tokensSent: tokensSent()
      }
      await chatCache.store(cacheKey, payload)
      response.json(payload)
    }))
  } catch (error) {
    if (!response.headersSent) {
      response.status(error.status || 502).json({
        error: error.message || "Die Suche ist fehlgeschlagen."
      })
    }
  }
})

app.post("/api/search", async (request, response) => {
  try {
    await bind(() => withUsage(async () => {
    const filters = normalizeFilters(request.body?.filters)
    if (!hasAnchor(filters) && !hasConstraint(filters)) {
      response.json({ matches: [], salaryUnknown: [], total: 0, checked: 0, searched: false, filters, tokensSent: 0 })
      return
    }
    const result = await searchJobs(filters)
    response.json({ filters, searched: true, tokensSent: tokensSent(), ...result })
    }))
  } catch (error) {
    response.status(error.status || 502).json({
      error: error.message || "Die Suche ist fehlgeschlagen."
    })
  }
})

app.post("/api/file", express.raw({ type: () => true, limit: "4mb" }), async (request, response) => {
  try {
    await bind(async () => {
      const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body || "")
      if (!body.length) {
        response.status(400).json({ error: "Die Datei ließ sich nicht lesen." })
        return
      }
      const clean = await readFile(body, request.headers["content-type"])
      if (!clean) {
        log("Die Datei ließ sich nicht lesen")
        response.status(400).json({ error: "Die Datei ließ sich nicht lesen." })
        return
      }
      response.json({ text: clean })
    })
  } catch (error) {
    log(error.message || "Die Datei ließ sich nicht lesen")
    if (!response.headersSent) {
      response.status(400).json({ error: error.message || "Die Datei ließ sich nicht lesen." })
    }
  }
})

app.get("/api/log", (request, response) => {
  response.json({ lines: since(request.query.after) })
})

app.post("/api/log/end", (_request, response) => {
  end()
  response.json({ ok: true })
})

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Diese Route gibt es nicht." })
})

app.use(express.static(path.join(__dirname, "../public")))

const port = Number(process.env.PORT) || 3000
const server = app.listen(port, () => {
  console.log("Jobsuche läuft auf http://localhost:" + port)
})
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("Port " + port + " ist belegt. Setze in .env einen anderen PORT.")
    process.exit(1)
  }
  throw error
})
