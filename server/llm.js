const { AsyncLocalStorage } = require("node:async_hooks")
const { normalizeFilters } = require("./schema")
const { log } = require("./log")

const usage = new AsyncLocalStorage()

function noteSent(count) {
  const bag = usage.getStore()
  if (!bag) return
  bag.sent += Number(count) || 0
}

function tokensSent() {
  return usage.getStore()?.sent || 0
}

function withUsage(work) {
  return usage.run({ sent: 0 }, work)
}

function messageText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || part?.content || "").join("")
  }
  return ""
}


const REMOTE_READ = `Du liest den Text einer einzelnen Stellenanzeige.
Entscheide, ob die Stelle remote ist: Die Arbeit selbst findet von zu Hause oder ortsunabhängig statt, auch wenn der Satz ganz anders formuliert ist.
Eine bloße Möglichkeit ist nicht remote. Flexible Arbeitszeiten mit Option auf mobiles Arbeiten sind nicht remote. Einzelne Tage woanders auch nicht.
Lies den Zusammenhang im Text. Entscheide nicht, weil ein einzelnes Wort vorkommt.
Im Zweifel ist die Stelle nicht remote.
Antworte nur als JSON mit dem Feld remote, true oder false.`

const REMOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["remote"],
  properties: {
    remote: { type: "boolean" }
  }
}

const PARSE_MODEL = process.env.NVIDIA_PARSE_MODEL || process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-bolt-e4b"


async function askNemotron(messages, schema, name = "job_filters", maxTokens = 512, temperature = 0) {
  const response = await fetch(process.env.NVIDIA_BASE_URL + "/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: "Bearer " + process.env.NVIDIA_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: PARSE_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
      response_format: {
        type: "json_schema",
        json_schema: {
          name,
          strict: true,
          schema
        }
      }
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error("NVIDIA " + response.status + " " + detail.slice(0, 300))
  }
  const data = await response.json()
  noteSent(data.usage?.prompt_tokens ?? data.usage?.input_tokens)
  return messageText(data.choices?.[0]?.message?.content)
}

async function askChat(messages, maxTokens = 520, temperature = 0.35) {
  const response = await fetch(process.env.NVIDIA_BASE_URL + "/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(40000),
    headers: {
      Authorization: "Bearer " + process.env.NVIDIA_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: PARSE_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      chat_template_kwargs: { enable_thinking: false }
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error("NVIDIA " + response.status + " " + detail.slice(0, 300))
  }
  const data = await response.json()
  noteSent(data.usage?.prompt_tokens ?? data.usage?.input_tokens)
  return messageText(data.choices?.[0]?.message?.content)
}

const CHAT_SYSTEM = `Du bist ein warmherziger, klarer Gesprächspartner für die Jobsuche. Du sprichst die Person mit du an. Kurz, menschlich, nie wie eine Hotline und nie wie ein Formular.

Zuerst schreibst du nur den Satz, den die Person liest. Danach kommt in derselben Antwort eine neue Zeile mit genau diesem Trenner und direkt dahinter ein JSON-Objekt, ohne Markdown und ohne Codeblock:

###DATA###
{"jobTitle":"","location":"","radius":null,"remote":null,"hybrid":null,"skills":[],"clauses":[],"readyToSearch":false}

Der gelesene Text enthält weder ###DATA### noch JSON noch Feldnamen. Kein Rezept, kein Code, keine Aufzählung. Ein bis drei Sätze.

Ton:
- Zögern ("eii lass mich überlegen", "hm", "moment"): empathisch und leicht, zum Beispiel "Klar, nimm dir Zeit!" Danach ein Satz zurück zur Jobsuche. readyToSearch false.
- Anderes Thema, etwa ein Rezept, Smalltalk oder Philosophie: kurz und charmant darauf eingehen, dann in ein bis zwei Sätzen zurück zur Jobsuche. Beispiel: "Klingt nach einem leckeren Rezept, aber lass uns danach schauen, wie wir das finanzieren..." readyToSearch false.
- Sag nie "Ich bin eine Job-KI und kann dir nur bei der Stellensuche helfen." Sag nie, etwas sei verboten. Keine Moral und kein Vortrag.
- Krise: ein kurzer ruhiger Satz, ohne Belehrung. readyToSearch false.

readyToSearch ist true nur, wenn klar gesucht werden soll und genug da ist: ein Beruf, oder ein klarer Ort, oder ein klares Remote- oder Hybrid-Vorhaben. Nachdenken, Geplauder und halbe Andeutungen bleiben false.

Felder, immer alle:
- jobTitle: ein Beruf oder eine Liste. Bei "oder" gehören alle Berufe hinein, nicht nur der erste.
- skills: die genannten Fähigkeiten, nicht die Jobtitel. "design + agentic coding" wird ["design", "agentic coding"].
- location: die Stadt, sonst "". "Deutschland" nur, wenn keine Stadt genannt ist.
- radius: die genannte Kilometerzahl, sonst null. Erfinde keinen Umkreis.
- remote und hybrid: true, false oder null.
- clauses: bei einem Oder aus Ort und Arbeitsmodell je ein Objekt mit location, radius, remote, hybrid. Sonst [].
- readyToSearch: true oder false.

Setze zusammengesetzte Bedingungen nicht zu einem einzigen Ort oder einem einzigen Remote-Flag zusammen. "remote deutschland oder hybrid wenn 50 km um Sankt Ingbert" bedeutet beide Zweige:
1) vollständig remote, überall in Deutschland
2) hybrid und nur innerhalb von 50 km um Sankt Ingbert
Dann ist location "Sankt Ingbert", radius 50, remote true, hybrid true, readyToSearch true. clauses enthält beide Zweige. Hybrid im Umkreis ist nicht vollständig remote. Die bundesweite Remote-Suche fällt nicht weg, nur weil auch eine Stadt genannt ist.
Leere Felder bleiben leer. Ältere Angaben merkt sich der Server, wenn ein Feld leer bleibt.`

function polish(text) {
  let out = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "")
  const at = out.lastIndexOf("###DATA###")
  if (at !== -1) out = out.slice(0, at)
  out = out.replace(/```(?:json)?[\s\S]*?```/gi, "")
  out = out.replace(/\{[\s\S]{0,4000}"readyToSearch"[\s\S]*$/i, "")
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
}

function parseDataBlock(raw) {
  let text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end < start) return null
  const slice = text.slice(start, end + 1)
  try {
    return JSON.parse(slice)
  } catch {
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"))
    } catch {
      return null
    }
  }
}

function splitReply(raw) {
  let text = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
  const mark = "###DATA###"
  const at = text.lastIndexOf(mark)
  let body = text
  let blob = ""
  if (at !== -1) {
    body = text.slice(0, at)
    blob = text.slice(at + mark.length)
  } else {
    const match = text.match(/\{[\s\S]*"readyToSearch"[\s\S]*\}\s*$/)
    if (match) {
      body = text.slice(0, match.index)
      blob = match[0]
    }
  }
  const assistantMessage = polish(body) || "Erzähl mir gern, wonach du suchst."
  return { assistantMessage, data: blob ? parseDataBlock(blob) : null }
}

function soundsCanned(text) {
  return /ich bin eine job-ki|kann dir nur bei der stellensuche|sicherheitsrichtlinie verletzt|um die jobsuche zu starten/i.test(String(text || ""))
}

function memoryNote(filters) {
  if (!filters || typeof filters !== "object") return ""
  const roles = Array.isArray(filters.roles) ? filters.roles.join(", ") : ""
  const place = filters.locationAny ? "bundesweit" : (Array.isArray(filters.locations) ? filters.locations.join(", ") : "")
  const quiet = !roles && !place && !filters.radiusKm && (filters.remote === "unspecified" || !filters.remote) && !filters.hybrid
  if (quiet) return ""
  return "Gedächtnis, nicht vorlesen und nicht ins JSON kopieren, wenn die neue Nachricht es nicht sagt: Rollen " + (roles || "keine")
    + ", Ort " + (place || "keiner")
    + ", Radius " + (filters.radiusKm || "keiner")
    + ", Remote " + (filters.remote || "unspecified")
    + ", Hybrid " + (filters.hybrid ? "ja" : "nein")
    + ". Leere Felder lassen diese Angaben stehen."
}

async function converse(messages, previousFilters) {
  log("Modell: antwortet im Gespräch")
  const history = messages.slice(-8).map((message) => ({
    role: message.role,
    content: String(message.content || "").slice(0, 2000)
  }))
  const memory = memoryNote(previousFilters)
  const payload = [
    { role: "system", content: CHAT_SYSTEM },
    ...(memory ? [{ role: "system", content: memory }] : []),
    ...history
  ]
  let raw = ""
  if (process.env.NVIDIA_API_KEY) {
    try {
      raw = await askChat(payload)
    } catch (error) {
      console.error("Nemotron:", error.message)
    }
  }
  if (!raw && process.env.OLLAMA_BASE_URL) {
    try {
      raw = await askLlama(payload, false)
    } catch (error) {
      console.error("Ollama:", error.message)
    }
  }
  if (!raw) throw unavailable()
  let split = splitReply(raw)
  if (soundsCanned(split.assistantMessage) && process.env.NVIDIA_API_KEY) {
    try {
      const retry = await askChat([
        ...payload,
        { role: "assistant", content: split.assistantMessage },
        { role: "user", content: "Das klang nach einer Hotline. Geh kurz und menschlich auf meinen Satz ein und lenk in ein bis zwei Sätzen zur Jobsuche zurück. Danach der Trenner ###DATA### und das JSON." }
      ])
      const again = splitReply(retry)
      if (again.assistantMessage && !soundsCanned(again.assistantMessage)) split = again
    } catch (error) {
      console.error("Nemotron:", error.message)
    }
  }
  return { ...split, provider: "nemotron" }
}


async function askLlama(messages, json = true) {
  const response = await fetch(process.env.OLLAMA_BASE_URL + "/api/chat", {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || "llama3.2",
      messages,
      stream: false,
      ...(json ? { format: "json" } : {})
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error("Ollama " + response.status + " " + detail.slice(0, 200))
  }
  const data = await response.json()
  noteSent(data.prompt_eval_count)
  return messageText(data.message?.content)
}

function unavailable() {
  const error = new Error("Beide Modelle sind gerade nicht erreichbar.")
  error.status = 502
  return error
}

function parseRemote(raw) {
  let text = String(raw || "").trim()
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end < start) throw new Error("Die Modellantwort enthält kein JSON.")
  const form = JSON.parse(text.slice(start, end + 1))
  if (typeof form.remote !== "boolean") throw new Error("Die Modellantwort enthält kein remote.")
  return form.remote
}

async function readRemote(text) {
  const messages = [
    { role: "system", content: REMOTE_READ },
    { role: "user", content: String(text || "").slice(0, 16000) }
  ]
  if (process.env.NVIDIA_API_KEY) {
    try {
      return parseRemote(await askNemotron(messages, REMOTE_SCHEMA, "remote_read", 80))
    } catch (error) {
      console.error("Nemotron:", error.message)
    }
  }
  try {
    return parseRemote(await askLlama(messages))
  } catch (error) {
    console.error("Ollama:", error.message)
    throw unavailable()
  }
}


function jsonSlice(raw) {
  let text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end < start) throw new Error("Die Modellantwort enthält kein JSON.")
  return text.slice(start, end + 1)
}

async function askJson(messages, schema, name, maxTokens = 200, temperature = 0) {
  if (process.env.NVIDIA_API_KEY) {
    try {
      return await askNemotron(messages, schema, name, maxTokens, temperature)
    } catch (error) {
      console.error("Nemotron:", error.message)
    }
  }
  return askLlama(messages)
}

const AD_READ = `Du liest den Titel und den Text einer einzelnen Stellenanzeige.
Die Person sucht das, was in der Nutzerzeile hinter "Gesucht:" steht.
fit ist true, wenn die Anzeige in der Sache dasselbe meint. Der Titel darf anders heißen.
Ein Software Engineer, in dessen Text UX/UI Design und Arbeiten mit einem Coding-Agenten steht, passt auf eine Suche nach Design Engineer mit agentic coding.
Ein Titel, der nur ähnlich klingt, passt nicht, wenn der Text eine andere Arbeit beschreibt.
Lies den Zusammenhang. Entscheide nicht, weil ein einzelnes Wort vorkommt oder fehlt. Keine feste Wortliste.
Im Zweifel ist fit false.
remote ist true nur, wenn die Arbeit selbst von zu Hause oder ortsunabhängig stattfindet. Eine bloße Möglichkeit, einzelne Tage oder ein Teil der Woche sind nicht remote. Im Zweifel ist remote false.
why ist ein kurzer Satz. Wenn die Anzeige nicht passt oder nicht remote ist, steht darin der Grund.
Antworte nur als JSON mit fit, remote und why.`

const AD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fit", "remote", "why"],
  properties: {
    fit: { type: "boolean" },
    remote: { type: "boolean" },
    why: { type: "string" }
  }
}

function parseAd(raw) {
  const form = JSON.parse(jsonSlice(raw))
  return {
    fit: form.fit === true,
    remote: form.remote === true,
    why: String(form.why || "").trim()
  }
}

const TEASER = 240

function shortenAd(text) {
  const raw = String(text || "")
  const marker = "\n\nText:"
  const at = raw.indexOf(marker)
  const body = (at === -1 ? raw : raw.slice(at + marker.length)).replace(/\s+/g, " ").trim().slice(0, TEASER)
  if (at === -1) return body
  return raw.slice(0, at + marker.length) + " " + body
}

async function readAd(text) {
  log("Modell: liest die Anzeige")
  const messages = [
    { role: "system", content: AD_READ },
    { role: "user", content: shortenAd(text) }
  ]
  try {
    return parseAd(await askJson(messages, AD_SCHEMA, "ad_read", 160))
  } catch (error) {
    console.error("Anzeige:", error.message)
    return { fit: false, remote: false, why: "" }
  }
}

const ENRICH_READ = `Du ergänzt eine Jobsuche.
aliases sind nur übliche Stellenbezeichnungen, die in echten Anzeigen für dieselbe Arbeit stehen. Für Product Designer zum Beispiel UX Designer oder UI Designer.
Keine Metaphern, keine neuen Berufe, kein Soll von zehn Stück. Im Zweifel weglassen. Die Rolle selbst nicht wiederholen.
skills bleiben die genannten Sachwörter. Wenn die Person eine Sache wie agentic coding meint, erfinde dazu passende Begriffe. Sonst bleibt skills leer.
Antworte nur als JSON mit aliases und skills.`

const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aliases", "skills"],
  properties: {
    aliases: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } }
  }
}

async function enrichFilters(filters, text) {
  const roles = filters.roles || []
  if (!roles.length || (filters.aliases || []).length) return filters
  log("Modell: ergänzt Bezeichnungen")
  try {
    const messages = [
      { role: "system", content: ENRICH_READ },
      { role: "user", content: "Nachricht: " + text + "\nRollen: " + roles.join(", ") + "\nBisher: " + JSON.stringify({ skills: filters.skills, intent: filters.intent }) }
    ]
    let raw
    try {
      raw = await askNemotron(messages, ENRICH_SCHEMA, "enrich", 300, 0)
    } catch (error) {
      console.error("Nemotron:", error.message)
      raw = await askLlama(messages)
    }
    const form = JSON.parse(jsonSlice(raw))
    const aliases = Array.isArray(form.aliases) ? form.aliases.map((item) => String(item).trim()).filter(Boolean) : []
    const skills = Array.isArray(form.skills) ? form.skills.map((item) => String(item).trim()).filter(Boolean) : []
    return normalizeFilters({
      ...filters,
      aliases: aliases.length ? aliases : filters.aliases,
      skills: skills.length ? skills : filters.skills
    })
  } catch (error) {
    console.error("Aliase:", error.message)
    return filters
  }
}

const TITLE_READ = `Du sortierst Titel, bevor der Anzeigentext gelesen wird.
Die gesuchte Stelle steht hinter "Gesucht:". Die Wörter gehören zusammen. "Frontend PHP" ist eine Stelle, nicht PHP allein.
drop ist true, wenn der Titel offensichtlich ein anderer Beruf ist, zum Beispiel Maler, Pflege oder Lager.
drop ist false, wenn der Titel dieselbe Arbeit sein kann, auch unter einem anderen Namen. Softwareentwickler, Webentwickler und Frontend Developer bleiben.
Im Zweifel ist drop false.
Antworte nur als JSON mit drop, einer Liste aus true oder false, in derselben Reihenfolge wie die Titel, genau ein Wert pro Titel.`

const TITLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["drop"],
  properties: {
    drop: { type: "array", items: { type: "boolean" } }
  }
}

function parseDrops(raw, count) {
  const form = JSON.parse(jsonSlice(raw))
  const drop = Array.isArray(form.drop) ? form.drop : []
  return Array.from({ length: count }, (_, index) => drop[index] === true)
}

async function scanTitles(intent, titles) {
  const count = titles.length
  if (!count) return []
  log("Modell: sortiert die Titel")
  const lines = titles.map((title, index) => (index + 1) + ". " + title).join("\n")
  const messages = [
    { role: "system", content: TITLE_READ },
    { role: "user", content: "Gesucht: " + String(intent || "").slice(0, 500) + "\n\nTitel:\n" + lines.slice(0, 12000) }
  ]
  try {
    let raw
    try {
      raw = await askNemotron(messages, TITLE_SCHEMA, "title_scan", 200, 0)
    } catch (error) {
      console.error("Nemotron:", error.message)
      raw = await askLlama(messages)
    }
    return parseDrops(raw, count)
  } catch (error) {
    console.error("Titel:", error.message)
    return Array.from({ length: count }, () => false)
  }
}

const EXPAND_READ = `Du erweiterst einen Suchbegriff für eine deutsche Jobbörse.
terms sind das genannte Wort, Wortstämme, die so in Stellentiteln vorkommen, Synonyme und übliche Berufsbezeichnungen. Höchstens 8.
"putzen" wird putzen, putz, reinigung, putzhilfe, reinigungskraft, spülhilfe, säubern. Der Stamm "putz" steckt in "Putz- und Spülhilfe".
title ist die eine übliche Stellenbezeichnung für den Tag. "putzen" wird "Reinigungskraft", nicht "Putz". Nennt die Person schon eine Bezeichnung, bleibt title genau diese Bezeichnung.
Kein anderer Beruf. Keine Metaphern.
Antworte nur als JSON mit title und terms.`

const EXPAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "terms"],
  properties: {
    title: { type: "string" },
    terms: { type: "array", items: { type: "string" } }
  }
}

function isStem(text, role) {
  const name = String(role || "").toLowerCase().trim()
  if (name.length < 3) return false
  const words = String(text || "").toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || []
  if (words.some((word) => word === name)) return false
  return words.some((word) => word.startsWith(name))
}

async function expandQuery(filters, text) {
  const spoken = String(text || "").trim()
  const hasTerm = (filters.roles || []).length || String(filters.query || "").trim()
  if (!spoken || !hasTerm) return filters
  log("Modell: erweitert die Suche")
  try {
    const messages = [
      { role: "system", content: EXPAND_READ },
      { role: "user", content: "Nachricht: " + spoken.slice(0, 500) + "\nBisher: " + (filters.query || (filters.roles || []).join(", ")) }
    ]
    let raw
    try {
      raw = await askNemotron(messages, EXPAND_SCHEMA, "expand_query", 400, 0)
    } catch (error) {
      console.error("Nemotron:", error.message)
      raw = await askLlama(messages)
    }
    const form = JSON.parse(jsonSlice(raw))
    const terms = Array.isArray(form.terms) ? form.terms.map((item) => String(item).trim()).filter(Boolean).slice(0, 8) : []
    const title = String(form.title || "").trim()
    const roles = filters.roles || []
    const next = {
      ...filters,
      expansion: terms.length ? terms : filters.expansion
    }
    const rough = !roles.length || roles.every((role) => isStem(spoken, role))
    if (title && rough) {
      next.roles = [title]
      const query = String(next.query || "")
      if (!query || query.toLowerCase() === spoken.toLowerCase() || isStem(spoken, query)) next.query = title
    }
    const ready = normalizeFilters(next)
    log("Begriffe: " + (ready.expansion || []).join(", "))
    return ready
  } catch (error) {
    console.error("Erweiterung:", error.message)
    return filters
  }
}

const EXACT_READ = `Du extrahierst harte Eigennamen aus einem Text oder Lebenslauf.
terms sind nur IT-Zertifikate, konkrete Software und exakte Produktnamen, die so im Text stehen. Zum Beispiel AWS Certified Solutions Architect oder SAP S/4HANA.
Keine Berufe, keine Städte, keine Soft Skills, nichts Erfundenes. Steht nichts davon da, bleibt terms leer.
Antworte nur als JSON mit terms.`

const EXACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["terms"],
  properties: {
    terms: { type: "array", items: { type: "string" } }
  }
}

async function extractExactTerms(filters, text) {
  const spoken = String(text || "").trim()
  if (!spoken) return filters
  // EXTRAKTION: Zertifikate, Tools und Produktnamen vor der Suche
  log("Modell: liest Zertifikate")
  try {
    const raw = await askJson([
      { role: "system", content: EXACT_READ },
      { role: "user", content: spoken.slice(0, 6000) }
    ], EXACT_SCHEMA, "exact_terms", 200)
    const form = JSON.parse(jsonSlice(raw))
    const terms = Array.isArray(form.terms)
      ? form.terms.map((item) => String(item).trim()).filter((item) => item.length >= 2).slice(0, 12)
      : []
    const next = normalizeFilters({ ...filters, exactTerms: terms })
    log("Zertifikate: " + (next.exactTerms.join(", ") || "keine"))
    return next
  } catch (error) {
    console.error("Zertifikate:", error.message)
    return filters
  }
}


module.exports = { converse, splitReply, readRemote, readAd, enrichFilters, expandQuery, extractExactTerms, scanTitles, withUsage, tokensSent }
