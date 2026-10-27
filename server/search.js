const { log, active } = require("./log")
const { listings, load } = require("./sources")
const { readAd, scanTitles } = require("./llm")
const { locate, towns, inside, closestKm } = require("./geo")
const { clearDesignTitle, designSearch, unrelatedTitle, fullyRemoteText } = require("./titles")
const { semanticCache, hashEmbed } = require("./semantic-cache")
const { HnswIndex } = require("./hnsw")

function euro(value) {
  return new Intl.NumberFormat("de-DE").format(value) + " €"
}

function addAmount(amounts, raw) {
  const value = Number(String(raw).replace(/\./g, ""))
  if (value >= 15000 && value <= 500000) amounts.add(value)
}

function salaryBand(text) {
  const amounts = new Set()
  const dotted = /(?<!\d)(\d{1,3}(?:\.\d{3})+)(?!\d)\s*(?:€|eur(?:o)?|brutto)/gi
  const plain = /(?<!\d)(\d{5,6})(?!\d)\s*(?:€|eur(?:o)?|brutto)/gi
  const labeled = /(?:gehalt|verg[üu]tung|brutto|jahresgehalt|einstiegsgehalt)[^.\d]{0,40}(\d{1,3}(?:\.\d{3})+|\d{5,6})(?!\d)/gi
  for (const pattern of [dotted, plain, labeled]) {
    for (const match of text.matchAll(pattern)) addAmount(amounts, match[1])
  }
  if (!amounts.size) return null
  const values = [...amounts]
  return { min: Math.min(...values), max: Math.max(...values) }
}

function containsTerm(text, term) {
  return text.toLowerCase().includes(String(term).toLowerCase())
}

function hardWhy(job, filters) {
  if (filters.employment === "part-time" && !job.partTime) return "Die Stelle ist nicht in Teilzeit."
  if (filters.employment === "full-time" && !job.fullTime) return "Die Stelle ist nicht in Vollzeit."
  if (filters.permanent === true && job.permanent !== true) return "Die Stelle ist nicht unbefristet."
  if (filters.permanent === false && job.permanent !== false) return "Die Stelle ist nicht befristet."
  if (filters.excludeTempAgency && job.tempAgency) return "Das ist Zeitarbeit."
  return ""
}

function passesHard(job, filters) {
  return !hardWhy(job, filters)
}

function rejectedJob(job, why) {
  return {
    id: job.id,
    title: job.title,
    company: job.company || "",
    url: job.url || "",
    why
  }
}

function listingUrl(item) {
  try {
    const parsed = new URL(item.externeURL)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href
  } catch {
    // Die Anzeige hat keinen brauchbaren externen Link.
  }
  return item.referenznummer
    ? "https://www.arbeitsagentur.de/jobsuche/jobdetail/" + encodeURIComponent(item.referenznummer)
    : ""
}

function rejectedListing(item, why) {
  return {
    id: item.referenznummer || why,
    title: String(item.stellenangebotsTitel || "Stelle").trim(),
    company: String(item.firma || "").trim(),
    url: listingUrl(item),
    why
  }
}

function readIntent(filters) {
  const base = filters.intent || filters.query || (filters.roles || []).join(" oder ")
  const roles = new Set((filters.roles || []).map((role) => String(role).toLowerCase()))
  const aliases = (filters.aliases || []).filter((alias) => alias && !roles.has(String(alias).toLowerCase()))
  const extra = (filters.expansion || []).filter((term) => term && !roles.has(String(term).toLowerCase()))
  const parts = [base]
  if (aliases.length) parts.push("Übliche andere Bezeichnungen: " + aliases.join(", "))
  if (extra.length) parts.push("Auch: " + extra.join(", "))
  return parts.filter(Boolean).join(". ")
}

function stemInTitle(title, filters) {
  const hay = String(title || "").toLowerCase()
  const terms = [filters.query, ...(filters.roles || []), ...(filters.expansion || [])]
  return terms.some((term) => {
    const needle = String(term || "").toLowerCase().trim()
    return needle.length >= 4 && hay.includes(needle)
  })
}

function reasonsFor(job, filters, text, band, remote) {
  const reasons = []
  for (const skill of filters.skills) {
    if (containsTerm(text, skill)) reasons.push(skill)
  }
  if (remote) reasons.push("Remote")
  if (band) {
    reasons.push(band.min === band.max ? euro(band.max) + " genannt" : euro(band.min) + "–" + euro(band.max))
  }
  if (filters.locations.some((city) => city.toLowerCase() === job.location.toLowerCase())) {
    reasons.push(job.location)
  }
  if (filters.employment === "part-time" && job.partTime) reasons.push("Teilzeit")
  if (filters.employment === "full-time" && job.fullTime) reasons.push("Vollzeit")
  if (filters.permanent === true && job.permanent === true) reasons.push("unbefristet")
  return reasons.slice(0, 3)
}

function present(job, filters, text, band, salaryKnown, remote) {
  return {
    id: job.id,
    source: job.source,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    remote,
    salaryMin: band ? band.min : null,
    salaryMax: band ? band.max : null,
    salaryKnown,
    reasons: reasonsFor(job, filters, text, salaryKnown ? band : null, remote)
  }
}

function jobText(job) {
  return (job.title + "\n" + job.description).replace(/[ \t]+/g, " ").trim()
}

function salaryDrop(job, filters) {
  const asked = filters.salaryMin != null || filters.salaryMax != null
  if (!asked) return ""
  const band = salaryBand(jobText(job))
  if (!band) return "Gehalt steht nicht in der Anzeige."
  if (filters.salaryMin != null && band.max < filters.salaryMin) return "Gehalt liegt unter dem genannten Minimum."
  if (filters.salaryMax != null && band.min > filters.salaryMax) return "Gehalt liegt über dem genannten Maximum."
  return ""
}

const RRF_K = 60

function exactHits(job, terms) {
  const hay = (job.title + "\n" + (job.description || "")).toLowerCase()
  return terms.filter((term) => {
    const needle = String(term || "").toLowerCase().trim()
    return needle.length >= 2 && hay.includes(needle)
  })
}

function hybridRank(jobs, filters) {
  const terms = (filters.exactTerms || []).map((term) => String(term || "").trim()).filter(Boolean)
  if (jobs.length < 2 || !terms.length) return jobs
  const query = [filters.query, ...(filters.roles || []), ...terms].filter(Boolean).join(" ")
  const queryVector = hashEmbed(query)

  // VEKTORSUCHE: HNSW über Titel und Teaser
  const index = new HnswIndex()
  for (const job of jobs) {
    const teaser = job.title + " " + String(job.description || "").replace(/\s+/g, " ").trim().slice(0, 240)
    index.add(String(job.id), hashEmbed(teaser))
  }
  const vectorRank = new Map()
  index.search(queryVector, -1).forEach((hit, rank) => vectorRank.set(hit.id, rank + 1))

  // KEYWORD-SUCHE: exakter Substring der Zertifikate und Produktnamen
  const keywordRank = new Map()
  jobs
    .map((job) => ({ id: String(job.id), hits: exactHits(job, terms) }))
    .filter((item) => item.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || b.hits.join("").length - a.hits.join("").length)
    .forEach((item, rank) => keywordRank.set(item.id, rank + 1))

  // FUSION: RRF, Treffer aus beiden Listen nach oben
  return jobs
    .map((job) => {
      const id = String(job.id)
      const vector = vectorRank.get(id)
      const keyword = keywordRank.get(id)
      let score = 0
      if (vector) score += 1 / (RRF_K + vector)
      if (keyword) score += 1 / (RRF_K + keyword)
      if (vector && keyword) score += 1
      return { job, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.job)
}

function narrowJobs(jobs, filters, verdictById) {
  const matches = []
  const salaryUnknown = []
  const rejected = []
  const salaryAsked = filters.salaryMin != null || filters.salaryMax != null
  const remoteAsked = filters.remote === "required"

  for (const job of jobs) {
    const text = jobText(job)
    const hard = hardWhy(job, filters)
    if (hard) {
      rejected.push(rejectedJob(job, hard))
      continue
    }
    let verdict = verdictById?.get(job.id) || { fit: false, remote: false, why: "" }
    if (clearDesignTitle(job.title)) {
      verdict = { ...verdict, fit: true }
    }
    if (fullyRemoteText(jobText(job))) verdict = { ...verdict, remote: true }
    if (!verdict?.fit) {
      rejected.push(rejectedJob(job, verdict?.why || "Die Anzeige passt nicht zur Suche."))
      continue
    }
    const remote = verdict.remote === true
    // Hybrid im Umkreis ist nicht vollständig remote und bleibt in der lokalen Suche.
    if (remoteAsked && !filters.hybrid && !remote) {
      rejected.push(rejectedJob(job, verdict.why || "Die Stelle ist nicht vollständig remote."))
      continue
    }
    const blocked = salaryAsked ? salaryDrop(job, filters) : ""
    if (blocked) {
      rejected.push(rejectedJob(job, blocked))
      continue
    }
    const band = salaryBand(text)
    matches.push(present(job, filters, text, band, Boolean(band), remote))
  }

  return { matches, salaryUnknown, rejected }
}

async function keepNearby(jobs, filters) {
  const places = towns(filters.locations)
  if (!filters.radiusKm || !places.length) return { nearby: jobs, outside: [] }
  const centers = (await Promise.all(places.map((place) => locate(place)))).filter(Boolean)
  if (!centers.length) {
    return { nearby: [], outside: jobs.map((job) => rejectedJob(job, "Der Ort ließ sich nicht zuordnen.")) }
  }
  const nearby = []
  const outside = []
  for (const job of jobs) {
    const km = closestKm(job.coordinates, centers[0])
    const kept = inside(job, centers, filters.radiusKm)
    if (kept) nearby.push(job)
    else {
      const away = km == null ? "ohne Koordinate" : Math.round(km) + " km"
      outside.push(rejectedJob(job, "Die Stelle liegt außerhalb des Umkreises (" + away + ")."))
    }
  }
  log("Umkreis " + filters.radiusKm + " km " + places.join(", ") + ": " + nearby.length + " behalten, " + outside.length + " außerhalb")
  return { nearby, outside }
}

function keptVerdict(verdict, filters) {
  if (!verdict?.fit) return false
  if (filters.remote === "required" && !filters.hybrid && verdict.remote !== true) return false
  return true
}

async function eachAd(jobs, filters) {
  const verdictById = new Map()
  let cursor = 0
  async function worker() {
    while (cursor < jobs.length && active()) {
      const index = cursor
      const job = jobs[index]
      cursor += 1
      // KOMPRESSION: das Modell sieht Titel und Teaser, nicht die ganze Anzeige
      let verdict = await readAd("Gesucht: " + readIntent(filters) + "\n\nTitel: " + job.title + "\n\nText: " + job.description)
      if (clearDesignTitle(job.title)) verdict = { ...verdict, fit: true }
      if (fullyRemoteText(job.title + "\n" + job.description)) verdict = { ...verdict, remote: true }
      if (!active()) return
      verdictById.set(job.id, verdict)
      const kept = keptVerdict(verdict, filters)
      const blocked = kept ? salaryDrop(job, filters) : ""
      const shown = kept && !blocked
      let line = "Anzeige " + (index + 1) + " von " + jobs.length + ": " + job.title + (shown ? " passt" : " fällt weg")
      if (!shown) {
        if (blocked) line += "\n" + blocked
        else if (filters.remote === "required" && verdict.fit && verdict.remote !== true) line += "\nNicht vollständig remote."
        else line += verdict.why ? "\nModell: " + verdict.why : "\nDie Anzeige passt nicht zur Suche."
      }
      log(line)
    }
  }
  const workers = Math.min(4, jobs.length)
  if (workers) await Promise.all(Array.from({ length: workers }, worker))
  return verdictById
}

function none() {
  return { matches: [], salaryUnknown: [], rejected: [], total: 0, checked: 0 }
}

async function runSearch(filters) {
  if (!active()) return none()
  // PRE-FILTER: Ort, Umkreis, Arbeitszeit und Befristung gehen an die Jobbörse, bevor Titel gelesen werden.
  const listed = await listings(filters)
  if (!active()) return none()
  const titles = listed.items.map((item) => String(item.stellenangebotsTitel || "Stelle").trim())
  const intent = filters.intent || filters.query || filters.roles.join(" oder ")
  const openRole = !String(intent).trim()
  const shaped = designSearch(filters)
  const drop = titles.length && !openRole && !shaped ? await scanTitles(readIntent(filters), titles) : []
  if (!active()) return none()
  const kept = []
  const rejected = []
  titles.forEach((title, index) => {
    if (shaped && (unrelatedTitle(title) || !clearDesignTitle(title))) {
      log("Titel weg: " + title)
      rejected.push(rejectedListing(listed.items[index], "Der Titel gehört nicht zu Product, UX oder UI Design."))
      return
    }
    if (drop[index] && !stemInTitle(title, filters)) {
      log("Titel weg: " + title)
      rejected.push(rejectedListing(listed.items[index], "Der Titel passt nicht zur Suche."))
    } else {
      if (drop[index]) log("Titel bleibt: " + title)
      kept.push(listed.items[index])
    }
  })
  const jobs = await load(kept)
  if (!active()) return none()
  const split = await keepNearby(jobs, filters)
  log(kept.length + " Titel bleiben")
  const candidates = split.nearby.filter((job) => passesHard(job, filters))
  for (const job of split.nearby) {
    const why = hardWhy(job, filters)
    if (why) rejected.push(rejectedJob(job, why))
  }
  rejected.push(...split.outside)
  let verdictById
  const designLocal = shaped && filters.remote !== "required"
  if (designLocal || (openRole && filters.remote !== "required")) {
    verdictById = new Map(candidates.map((job) => [job.id, {
      fit: designLocal ? clearDesignTitle(job.title) : true,
      remote: fullyRemoteText(jobText(job)) || job.remote === true,
      why: ""
    }]))
  } else {
    verdictById = candidates.length ? await eachAd(candidates, filters) : new Map()
  }
  const narrowed = narrowJobs(hybridRank(candidates, filters), filters, verdictById)
  log("Treffer: " + (narrowed.matches.length ? narrowed.matches.map((job) => job.title).join(" | ") : "keine"))
  return {
    ...narrowed,
    rejected: [...rejected, ...narrowed.rejected],
    total: listed.total,
    checked: titles.length
  }
}

function mergeResults(left, right) {
  const seen = new Set()
  const take = (lists) => lists.filter((job) => {
    if (seen.has(job.id)) return false
    seen.add(job.id)
    return true
  })
  return {
    matches: take([...left.matches, ...right.matches]),
    salaryUnknown: take([...left.salaryUnknown, ...right.salaryUnknown]),
    rejected: take([...(left.rejected || []), ...(right.rejected || [])]),
    total: left.total + right.total,
    checked: left.checked + right.checked
  }
}

function bothWays(filters) {
  return Boolean(filters.alsoFullyRemote && filters.radiusKm && filters.locations?.length)
}

function withoutSplit(filters) {
  return { ...filters, branches: [], alsoFullyRemote: false }
}

function branchPlan(filters) {
  if (Array.isArray(filters.branches) && filters.branches.length >= 2) {
    return filters.branches.map((branch, index) => ({
      label: branch.label || ("Zweig " + (index + 1)),
      filters: withoutSplit(branch.filters || {})
    }))
  }
  if (!bothWays(filters)) return null
  const city = (filters.locations || []).join(", ")
  const base = withoutSplit(filters)
  return [
    {
      label: "remote deutschland (bundesweit, vollständig remote)",
      filters: {
        ...base,
        locations: [],
        locationAny: true,
        radiusKm: null,
        remote: "required",
        hybrid: false
      }
    },
    {
      label: "hybrid " + filters.radiusKm + " km " + city + " (nicht vollständig remote)",
      filters: {
        ...base,
        locations: [...(filters.locations || [])],
        locationAny: false,
        radiusKm: filters.radiusKm,
        remote: "allowed",
        hybrid: true
      }
    }
  ]
}

async function collect(filters) {
  const plan = branchPlan(filters)
  if (!plan) return runSearch(filters)
  let merged = null
  let failure = null
  for (const branch of plan) {
    // Zwei echte Suchen: bundesweit remote, und hybrid nur im Umkreis.
    log("Zweig: " + branch.label)
    try {
      const result = await runSearch(branch.filters)
      merged = merged ? mergeResults(merged, result) : result
    } catch (error) {
      log("Zweig fehlgeschlagen: " + branch.label)
      failure = error
    }
  }
  if (!merged) throw failure || new Error("Die Suche ist fehlgeschlagen.")
  return merged
}

async function searchJobs(filters) {
  // SEMANTIC CACHE: erste Schicht, Treffer bei Cosine Similarity über 0.95
  const cached = await semanticCache.find(filters)
  if (cached) {
    log("Cache-Treffer")
    return { ...cached, cached: true }
  }
  const result = await collect(filters)
  await semanticCache.store(filters, result)
  return result
}

module.exports = { searchJobs, narrowJobs, hybridRank, salaryBand }
