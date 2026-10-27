const messages = document.querySelector("#messages")
const form = document.querySelector("#composer")
const input = document.querySelector("#input")
const sendButton = document.querySelector("#send")
const empty = document.querySelector("#empty")
const board = document.querySelector("#board")
const summary = document.querySelector("#summary")
const chips = document.querySelector("#chips")
const matches = document.querySelector("#matches")
const unknown = document.querySelector("#unknown")
const rejected = document.querySelector("#rejected")
const debug = document.querySelector("#debug")
const dock = document.querySelector("#dock")
const tokens = document.querySelector("#tokens")
const logBox = document.querySelector("#log")

const state = { messages: [], filters: null, safety: null }
const hint = document.querySelector("#hint")
const fileInput = document.querySelector("#file")
const voiceButton = document.querySelector("#voice")
const attachmentBox = document.querySelector("#attachment")
const attachmentName = document.querySelector("#attachment-name")
let attachment = ""
let attachedName = ""
let reading = null

function euro(value) {
  return new Intl.NumberFormat("de-DE").format(value) + " €"
}

function fileIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("width", "16")
  svg.setAttribute("height", "16")
  svg.setAttribute("aria-hidden", "true")
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
  path.setAttribute("d", "M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.82-2.83l8.48-8.48")
  path.setAttribute("fill", "none")
  path.setAttribute("stroke", "currentColor")
  path.setAttribute("stroke-width", "1.5")
  path.setAttribute("stroke-linecap", "round")
  path.setAttribute("stroke-linejoin", "round")
  svg.appendChild(path)
  return svg
}

function choose(option, box) {
  if (input.disabled) return
  for (const button of box.querySelectorAll("button")) button.disabled = true
  input.value = option
  form.requestSubmit()
}

function addBubble(role, text, fileName, options) {
  const article = document.createElement("article")
  article.className = "bubble " + role
  if (text) {
    const paragraph = document.createElement("p")
    paragraph.textContent = text
    article.appendChild(paragraph)
  }
  if (role === "assistant" && options?.length) {
    const choices = document.createElement("div")
    choices.className = "choices"
    for (const option of options) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "choice"
      button.textContent = option
      button.addEventListener("click", () => choose(option, choices))
      choices.appendChild(button)
    }
    article.appendChild(choices)
  }
  if (fileName) {
    const row = document.createElement("p")
    row.className = "file-row"
    row.append(fileIcon(), document.createTextNode(fileName))
    article.appendChild(row)
  }
  messages.appendChild(article)
  messages.scrollTop = messages.scrollHeight
}

function chipList(filters) {
  if (!filters) return []
  const items = []
  const seen = new Set()
  const add = (label) => {
    const clean = String(label || "").trim()
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) return
    items.push(clean)
    seen.add(key)
  }
  for (const role of filters.roles || []) add(role)
  const radius = filters.radiusKm ? ", " + filters.radiusKm + " km" : ""
  for (const place of filters.locations || []) add(place + radius)
  const min = filters.salaryMin
  const max = filters.salaryMax
  const amount = (value) => new Intl.NumberFormat("de-DE").format(value)
  if (min != null && max != null) add(min === max ? amount(min) + " €" : amount(min) + "–" + amount(max) + " €")
  else if (min != null) add("ab " + euro(min))
  else if (max != null) add("bis " + euro(max))
  return items
}

function paintChips(filters) {
  chips.replaceChildren()
  for (const label of chipList(filters)) {
    const chip = document.createElement("span")
    chip.className = "chip"
    chip.textContent = label
    chips.appendChild(chip)
  }
}

function paintCard(job) {
  const card = document.createElement(job.url ? "a" : "article")
  card.className = "card"
  if (job.url) {
    card.href = job.url
    card.target = "_blank"
    card.rel = "noopener noreferrer"
  }

  const title = document.createElement("h3")
  title.textContent = job.title
  card.appendChild(title)

  const company = document.createElement("p")
  company.className = "meta"
  company.textContent = job.company || ""
  if (company.textContent) card.appendChild(company)

  return card
}

function paintDebug(data, more, cached) {
  const sent = (Number(data.tokensSent) || 0) + (Number(more) || 0)
  const level = sent < 4000 ? "wenig" : sent < 20000 ? "mittel" : "viel"
  const fromCache = cached || data.cached
  const cacheNote = fromCache ? (sent === 0 ? " · Cache" : " · Suche aus Cache") : ""
  const body = data.extracted || {
    ready: data.ready,
    continues: data.continues,
    filters: data.filters
  }
  dock.hidden = false
  tokens.className = "tokens " + level
  tokens.textContent = "Tokens gesendet: " + sent.toLocaleString("de-DE") + " · " + level + cacheNote
  debug.textContent = JSON.stringify(body, null, 2)
}

function appendLogChunk(row, chunk) {
  const match = chunk.match(/^(.*?)Modell:\s*([\s\S]*)$/)
  if (!match) {
    row.append(chunk)
    return
  }
  if (match[1]) row.append(match[1])
  const tag = document.createElement("span")
  tag.className = "model-tag"
  tag.textContent = "Modell"
  row.append(tag)
  if (match[2]) row.append(match[2])
}

function addLog(text) {
  dock.hidden = false
  const row = document.createElement("p")
  row.className = "log-line"
  String(text).split("\n").forEach((chunk, index) => {
    if (index) row.appendChild(document.createElement("br"))
    appendLogChunk(row, chunk)
  })
  logBox.appendChild(row)
  logBox.scrollTop = logBox.scrollHeight
}

let logAfter = 0
async function pullLog() {
  try {
    const response = await fetch("/api/log?after=" + logAfter)
    const data = await response.json()
    for (const line of data.lines || []) {
      logAfter = line.id
      addLog(line.at + "  " + line.message)
    }
  } catch {
    // Das Protokoll kommt beim nächsten Mal.
  }
}
async function endLog() {
  logAfter = 0
  logBox.textContent = ""
  try {
    await fetch("/api/log/end", { method: "POST" })
  } catch {
    // Der nächste Poll holt dann nichts Altes, sobald der Server wieder antwortet.
  }
}
endLog().finally(() => setInterval(pullLog, 700))

function showBoard(visible) {
  empty.hidden = visible
  board.hidden = !visible
}

function salaryGap(filters, english) {
  const min = filters?.salaryMin
  const max = filters?.salaryMax
  if (min == null && max == null) return ""
  const euro = (value) => new Intl.NumberFormat(english ? "en-US" : "de-DE").format(value) + (english ? "" : " Euro")
  if (english) {
    let limit = "I skip ads that do not name a salary."
    if (min != null && max != null) limit = "I skip ads with no salary, and any outside " + euro(min) + " to " + euro(max) + "."
    else if (min != null) limit = "I skip ads with no salary, and any below " + euro(min) + "."
    else limit = "I skip ads with no salary, and any above " + euro(max) + "."
    return "Nothing matches. That can be because of the salary. " + limit
  }
  let limit = "Stellen ohne genanntes Gehalt zeige ich nicht."
  if (min != null && max != null) limit = "Stellen ohne genanntes Gehalt zeige ich nicht, und welche außerhalb von " + euro(min) + " bis " + euro(max) + " auch nicht."
  else if (min != null) limit = "Stellen ohne genanntes Gehalt zeige ich nicht, und welche unter " + euro(min) + " auch nicht."
  else limit = "Stellen ohne genanntes Gehalt zeige ich nicht, und welche über " + euro(max) + " auch nicht."
  return "Dazu passt keine Anzeige. Das kann am Gehalt liegen. " + limit
}

function paintRejected(job) {
  const card = document.createElement(job.url ? "a" : "article")
  card.className = "card"
  if (job.url) {
    card.href = job.url
    card.target = "_blank"
    card.rel = "noopener noreferrer"
  }
  const title = document.createElement("h3")
  title.textContent = job.title
  card.appendChild(title)
  if (job.why) {
    const why = document.createElement("p")
    why.className = "why"
    why.textContent = job.why
    card.appendChild(why)
  }
  return card
}

function paintJobs(data) {
  if (!data.searched) return
  showBoard(true)
  matches.replaceChildren()
  unknown.replaceChildren()
  summary.textContent = ""
  const dropped = data.rejected || data.salaryUnknown || []

  if (!data.matches.length) {
    const empty = document.createElement("p")
    empty.className = "empty"
    empty.textContent = "Dazu passt keine Anzeige."
    matches.appendChild(empty)
  } else {
    for (const job of data.matches) matches.appendChild(paintCard(job))
  }

  rejected.hidden = !dropped.length
  rejected.open = false
  rejected.querySelector("summary").textContent = dropped.length
    ? "Aussortiert · " + dropped.length
    : "Aussortiert"
  for (const job of dropped) unknown.appendChild(paintRejected(job))
}

function showTyping() {
  const article = document.createElement("article")
  article.className = "bubble assistant typing"
  article.id = "typing"
  article.setAttribute("role", "status")
  article.setAttribute("aria-label", "Antwort wird geladen")
  const dots = document.createElement("p")
  dots.setAttribute("aria-hidden", "true")
  for (let i = 0; i < 3; i += 1) dots.appendChild(document.createElement("span"))
  article.appendChild(dots)
  messages.appendChild(article)
  messages.scrollTop = messages.scrollHeight
}

function hideTyping() {
  document.querySelector("#typing")?.remove()
}

let savedView = null

function rememberView() {
  savedView = {
    emptyHidden: empty.hidden,
    boardHidden: board.hidden,
    summary: summary.textContent,
    chips: chips.innerHTML,
    matches: matches.innerHTML,
    unknown: unknown.innerHTML,
    rejectedHidden: rejected.hidden,
    rejectedOpen: rejected.open
  }
}

function restoreView() {
  if (!savedView) return
  empty.hidden = savedView.emptyHidden
  board.hidden = savedView.boardHidden
  summary.textContent = savedView.summary
  chips.innerHTML = savedView.chips
  matches.innerHTML = savedView.matches
  unknown.innerHTML = savedView.unknown
  rejected.hidden = savedView.rejectedHidden
  rejected.open = savedView.rejectedOpen
}

function showSkeleton() {
  rememberView()
  empty.hidden = true
  board.hidden = false
  summary.textContent = ""
  chips.replaceChildren()
  rejected.hidden = true
  rejected.open = false
  unknown.replaceChildren()
  matches.replaceChildren()
  for (let i = 0; i < 6; i += 1) {
    const card = document.createElement("div")
    card.className = "card skeleton"
    card.setAttribute("aria-hidden", "true")
    card.append(document.createElement("span"), document.createElement("span"))
    matches.appendChild(card)
  }
}

function setBusy(busy) {
  input.disabled = busy
  sendButton.disabled = busy
  voiceButton.disabled = busy
  fileInput.disabled = busy
  if (busy) showTyping()
  else hideTyping()
}

function showAttachment(name, readingFile) {
  attachmentName.textContent = readingFile ? name + " wird gelesen…" : name
  attachmentBox.hidden = false
  attachmentBox.classList.toggle("is-reading", readingFile)
  hint.textContent = readingFile ? "Die Datei wird noch gelesen. Senden geht gleich." : ""
  sendButton.disabled = readingFile || input.disabled
}

form.addEventListener("submit", async (event) => {
  event.preventDefault()
  if (input.disabled) return
  if (reading) {
    addLog("Datei wird noch gelesen")
    await reading
  }
  const typed = input.value.trim()
  const text = [typed, attachment].filter(Boolean).join("\n")
  if (!text) {
    addLog(hint.textContent || "Nichts zum Senden")
    return
  }
  const fileName = attachedName
  addLog(fileName ? (typed ? "Senden mit " + fileName : "Nur " + fileName + " wird gesendet") : "Senden")
  input.value = ""
  attachment = ""
  attachedName = ""
  attachmentBox.hidden = true
  hint.textContent = ""
  state.messages.push({ role: "user", content: text })
  addBubble("user", typed, fileName)
  setBusy(true)
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages, filters: state.filters, safety: state.safety })
    })
    const data = await response.json()
    if (!response.ok) {
      addBubble("assistant", data.error || "Die Suche ist fehlgeschlagen.")
      return
    }
    state.filters = data.filters
    state.safety = data.safety || null
    paintDebug(data)
    if (!data.ready) {
      state.messages.push({ role: "assistant", content: data.assistantMessage })
      addBubble("assistant", data.assistantMessage, null, data.options)
      return
    }
    hideTyping()
    showSkeleton()
    const search = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: data.filters })
    })
    const jobs = await search.json()
    if (!search.ok) {
      restoreView()
      addBubble("assistant", jobs.error || "Die Suche ist fehlgeschlagen.")
      return
    }
    const sentence = jobs.matches?.length ? data.assistantMessage : (salaryGap(data.filters, data.assistantMessage.startsWith("Here are")) || data.assistantMessage)
    state.messages.push({ role: "assistant", content: sentence })
    addBubble("assistant", sentence)
    paintChips(data.filters)
    paintJobs({ ...jobs, searched: true })
    paintDebug(data, jobs.tokensSent, jobs.cached)
  } catch {
    restoreView()
    addBubble("assistant", "Der Server antwortet nicht.")
  } finally {
    setBusy(false)
    input.focus()
  }
})

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0]
  fileInput.value = ""
  if (!file) return
  attachment = ""
  attachedName = file.name
  showAttachment(file.name, true)
  reading = (async () => {
    addLog(file.name + " wird hochgeladen")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 50000)
    try {
      const response = await fetch("/api/file", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: await file.arrayBuffer(),
        signal: controller.signal
      })
      const data = await response.json()
      if (!response.ok || !data.text) throw new Error(data.error || "Die Datei ließ sich nicht lesen.")
      attachment = data.text
      showAttachment(file.name, false)
      addLog(file.name + " gelesen, " + data.text.length + " Zeichen. Enter schickt sie auch ohne Text.")
    } catch (error) {
      attachment = ""
      attachedName = ""
      attachmentBox.hidden = true
      const message = error.name === "AbortError" ? "Die Datei hat zu lange gebraucht." : (error.message || "Die Datei ließ sich nicht lesen.")
      hint.textContent = message
      addLog(message)
    } finally {
      clearTimeout(timer)
      reading = null
      sendButton.disabled = input.disabled
    }
  })()
})

document.querySelector("#attachment-remove").addEventListener("click", () => {
  attachment = ""
  attachedName = ""
  reading = null
  attachmentBox.hidden = true
  hint.textContent = ""
})

voiceButton.addEventListener("click", () => {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Speech) {
    hint.textContent = "Spracherkennung fehlt in diesem Browser."
    return
  }
  const recognition = new Speech()
  recognition.lang = "de-DE"
  voiceButton.setAttribute("aria-pressed", "true")
  recognition.onresult = (event) => {
    input.value = event.results[0][0].transcript
    hint.textContent = ""
  }
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      hint.textContent = "Spracherkennung fehlt in diesem Browser."
    }
  }
  recognition.onend = () => voiceButton.setAttribute("aria-pressed", "false")
  recognition.start()
})

function greeting() {
  const hour = new Date().getHours()
  const hello = hour < 5 || hour >= 22
    ? "Gute Nacht"
    : "Guten " + (hour < 11 ? "Morgen" : hour < 18 ? "Tag" : "Abend")
  return hello + "! ☺️ Nach welchem Job suchst du? Sei gerne präzise."
}

const hello = greeting()
const notice = "Hinweis: Ich bin noch nicht fertig programmiert, es handelt sich um einen MVP. Beim fertigen Produkt sollen die Ergebnisse 100 % präzise sein!"
addBubble("assistant", hello + "\n\n" + notice)
state.messages.push({ role: "assistant", content: hello })

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
  if (event.target.closest && event.target.closest("a, button")) return
  event.preventDefault()
  form.requestSubmit()
})

const prompts = [
  "Remote React in München, Teilzeit, ab 70.000 Euro",
  "Pflegefachkraft in Hamburg, Vollzeit, unbefristet",
  "Data Analyst in Köln, Homeoffice, ab 55.000 Euro",
  "Elektriker in Leipzig, ohne Zeitarbeit",
  "Werkstudent Informatik in Berlin",
  "Python in Stuttgart, Festanstellung, kein PHP"
]
const prompt = document.querySelector("#prompt")
let promptIndex = 0

function showPrompt(index) {
  prompt.textContent = prompts[index]
}

showPrompt(0)
setInterval(() => {
  prompt.classList.add("is-fading")
  window.setTimeout(() => {
    promptIndex = (promptIndex + 1) % prompts.length
    showPrompt(promptIndex)
    prompt.classList.remove("is-fading")
  }, 280)
}, 4500)
