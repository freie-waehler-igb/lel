const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

const express = require("express")
const { interpret, relate, guardMessage, startReply, enrichFilters, expandQuery, extractExactTerms, withUsage, tokensSent } = require("./llm")
const { createSemanticCache } = require("./semantic-cache")
const chatCache = createSemanticCache()
const { readFile } = require("./readfile")
const { gateSearch, normalizeFilters, hasAnchor, hasConstraint } = require("./schema")
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

function wantsEnglish(text) {
  if (/[äöüß]/i.test(text)) return false
  if (/\b(ich|suche|such|bitte|ohne|nicht|eine|einen|der|die|das|und|für|mit|nach|stelle|beruf|weg|ab|euro)\b/i.test(text)) return false
  return /\b(i|i'm|im|am|please|search|searching|remove|without|english|looking|job|jobs)\b/i.test(text)
}

function rolePhrase(roles, english) {
  const labels = roles.filter((role) => !/^(jobs?|stellen?|berufe?)$/i.test(role)).map((role) => (
    english ? role + " jobs" : role + "-Jobs"
  ))
  if (!labels.length) return ""
  if (labels.length === 1) return labels[0]
  return labels.slice(0, -1).join(", ") + (english ? " or " : " oder ") + labels.at(-1)
}

function resultSentence(filters, text) {
  const english = wantsEnglish(text)
  const jobs = rolePhrase(filters.roles || [], english) || (english ? "jobs" : "Jobs")
  let place = ""
  if (filters.locationAny) place = english ? ", anywhere" : ", bundesweit"
  else if (filters.locations?.length) {
    place = " in " + filters.locations.join(english ? " and " : " und ")
    if (filters.radiusKm) place += " (" + filters.radiusKm + " km)"
    if (filters.alsoFullyRemote) {
      place += english ? ", or fully remote in Germany" : ", oder vollständig remote in Deutschland"
    }
  }
  const extras = []
  if (!filters.locations?.length && filters.remote === "required") extras.push("Remote")
  if (filters.remote === "onsite") extras.push(english ? "on-site" : "vor Ort")
  if (filters.employment === "part-time") extras.push(english ? "part-time" : "Teilzeit")
  if (filters.employment === "full-time") extras.push(english ? "full-time" : "Vollzeit")
  if (filters.salaryMin != null) {
    const money = new Intl.NumberFormat(english ? "en-US" : "de-DE").format(filters.salaryMin)
    extras.push((english ? "from " : "ab ") + money + (english ? "" : " Euro"))
  }
  if (filters.maxAgeHours) {
    const hours = filters.maxAgeHours
    const age = english
      ? "max " + hours + (hours === 1 ? " hour" : " hours") + " old"
      : "maximal " + hours + (hours === 1 ? " Stunde" : " Stunden") + " alt"
    extras.push(age)
  }
  const tail = extras.length ? ", " + extras.join(", ") : ""
  return (english ? "Here are " : "Hier sind ") + jobs + place + tail
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
    const cacheKey = { cacheText: last.content, context: users.length > 1 ? users.at(-2).content : "" }
    // KURZE EINGABE: unter zwei Wörtern oder ohne Beruf, Ort oder Gehalt kein Cache und kein Modell
    const fixedStart = startReply(last.content)
    if (fixedStart) {
      response.json({
        assistantMessage: fixedStart,
        filters: normalizeFilters(request.body?.filters ?? null),
        extracted: null,
        options: [],
        ready: false,
        safety: null,
        searched: false,
        provider: "nemotron",
        tokensSent: 0
      })
      return
    }
    const cachedChat = await chatCache.find(cacheKey)
    if (cachedChat) {
      log("Cache-Treffer")
      response.json({ ...cachedChat, tokensSent: 0, cached: true })
      return
    }
    // INPUT GUARDRAIL: off_topic, jailbreak und crisis_support enden hier, ohne Suche.
    // help antwortet mit dem festen Starttext und lässt die bisherigen Kriterien stehen.
    const guard = await guardMessage(last.content, cacheKey.context)
    if (guard.category === "help") {
      const payload = {
        assistantMessage: guard.message,
        filters: normalizeFilters(request.body?.filters ?? null),
        extracted: null,
        options: [],
        ready: false,
        safety: null,
        searched: false,
        provider: "nemotron",
        tokensSent: tokensSent()
      }
      await chatCache.store(cacheKey, payload)
      response.json(payload)
      return
    }
    if (!guard.valid) {
      const payload = {
        assistantMessage: guard.message,
        filters: normalizeFilters(null),
        extracted: null,
        options: [],
        ready: false,
        safety: null,
        searched: false,
        provider: "nemotron",
        tokensSent: tokensSent()
      }
      await chatCache.store(cacheKey, payload)
      response.json(payload)
      return
    }
    const link = await relate(messages)
    logContext(messages, link.related)
    const interpreted = await interpret(messages, link.related ? request.body?.filters ?? null : null, undefined, link.related)
    const gated = gateSearch(request.body?.filters ?? null, interpreted, last.content, link)
    const options = interpreted.options || []
    // SLOT FILLING: ein Bruchstück wie "p designer" fragt nach und sucht nicht
    if (options.length || isIncomplete(last.content)) {
      const payload = {
        assistantMessage: slotQuestion(last.content, interpreted.assistantMessage),
        filters: gated.filters,
        extracted: extractedFrom(interpreted, gated.filters),
        options,
        ready: false,
        safety: null,
        searched: false,
        provider: interpreted.provider,
        tokensSent: tokensSent()
      }
      await chatCache.store(cacheKey, payload)
      response.json(payload)
      return
    }
    if (interpreted.ready && !gated.search) {
      const expanded = await expandQuery({ ...gated.filters, query: gated.filters.query || last.content.trim() }, last.content)
      if ((expanded.roles || []).length || (expanded.expansion || []).length) {
        gated.filters = expanded
        gated.search = true
      }
    } else if (gated.search) {
      gated.filters = await expandQuery(gated.filters, last.content)
    }
    if (gated.search) {
      gated.filters = await extractExactTerms(gated.filters, last.content)
      gated.filters = await enrichFilters(gated.filters, last.content)
    }
    const extracted = extractedFrom(interpreted, gated.filters)
    const payload = {
      assistantMessage: gated.search ? resultSentence(gated.filters, last.content) : interpreted.assistantMessage,
      filters: gated.filters,
      extracted,
      ready: gated.search,
      safety: null,
      searched: false,
      provider: interpreted.provider,
      tokensSent: tokensSent()
    }
    await chatCache.store(cacheKey, payload)
    response.json(payload)
    }))
  } catch (error) {
    response.status(error.status || 502).json({
      error: error.message || "Die Suche ist fehlgeschlagen."
    })
  }
})

function isIncomplete(text) {
  const words = String(text).toLowerCase().match(/[a-zäöüß0-9+#]+/g) || []
  return words.some((word) => word.length === 1 && !/^\d$/.test(word))
}

function slotQuestion(text, message) {
  const spoken = String(message || "").trim()
  if (spoken && !/^(hier sind|here are)\b/i.test(spoken)) return spoken
  const fragment = (String(text).match(/\b[a-zäöü]\b/i) || [])[0]
  return fragment
    ? "Der Begriff ist unvollständig. Was meinst du mit \"" + fragment + "\"?"
    : "Welchen Beruf meinst du genau?"
}

function logContext(messages, related) {
  const users = messages.filter((message) => message.role === "user")
  const next = clip(users.at(-1)?.content || "")
  const previous = users.length > 1 ? clip(users.at(-2).content) : ""
  if (related && previous) {
    log("context: ja\n" + previous + " + " + next)
    return
  }
  log("context: nein\n" + next)
}

function clip(text) {
  const line = String(text).replace(/\s+/g, " ").trim()
  return line.length > 180 ? line.slice(0, 180) + "…" : line
}

function extractedFrom(interpreted, filters) {
  return {
    ready: Boolean(interpreted?.ready),
    continues: Boolean(interpreted?.continues),
    options: interpreted?.options || [],
    filters: filters || interpreted?.filters || null
  }
}

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
