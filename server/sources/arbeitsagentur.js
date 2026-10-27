const { namesFor, towns, canonicalState } = require("../geo")
const { log, active } = require("../log")

const API = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service"
const PAGE = 20
const HEADERS = {
  "X-API-Key": "jobboerse-jobsuche",
  Accept: "application/json",
  "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse)"
}
const PART_TIME_FIELDS = [
  "arbeitszeitTeilzeitAbend",
  "arbeitszeitTeilzeitNachmittag",
  "arbeitszeitTeilzeitVormittag",
  "arbeitszeitTeilzeitFlexibel"
]

function agencyDown() {
  const error = new Error("Die Jobsuche antwortet gerade nicht.")
  error.status = 502
  return error
}

async function getJson(path) {
  let response
  try {
    response = await fetch(API + path, {
      headers: HEADERS,
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    throw agencyDown()
  }
  if (!response.ok) throw agencyDown()
  return response.json()
}

function plainText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function safeUrl(url, id) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href
  } catch {
    // Die Anzeige hat keinen brauchbaren externen Link.
  }
  return "https://www.arbeitsagentur.de/jobsuche/jobdetail/" + encodeURIComponent(id)
}

function flag(detail, item, key) {
  if (typeof detail[key] === "boolean") return detail[key]
  if (typeof item[key] === "boolean") return item[key]
  return false
}

function contract(detail, item) {
  const value = detail.vertragsdauer || item.vertragsdauer
  if (value === "UNBEFRISTET") return true
  if (value === "BEFRISTET") return false
  return null
}

function coordinatesOf(item, detail) {
  const seen = new Set()
  const points = []
  for (const loc of [...(item.stellenlokationen || []), ...(detail.stellenlokationen || [])]) {
    const lat = Number(loc?.breite)
    const lon = Number(loc?.laenge)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const key = lat.toFixed(3) + "," + lon.toFixed(3)
    if (seen.has(key)) continue
    seen.add(key)
    points.push({ lat, lon })
  }
  return points
}

function toJob(item, detail) {
  const place = item.stellenlokationen?.[0]?.adresse || detail.stellenlokationen?.[0]?.adresse
  const remoteValue = typeof detail.homeofficemoeglich === "boolean"
    ? detail.homeofficemoeglich
    : item.homeofficemoeglich
  return {
    id: item.referenznummer,
    source: "arbeitsagentur",
    title: String(item.stellenangebotsTitel || detail.stellenangebotsTitel || "Stelle").trim(),
    company: String(item.firma || detail.firma || "").trim(),
    location: String(place?.ort || "").trim(),
    coordinates: coordinatesOf(item, detail),
    url: safeUrl(item.externeURL || detail.externeURL, item.referenznummer),
    remote: typeof remoteValue === "boolean" ? remoteValue : null,
    fullTime: flag(detail, item, "arbeitszeitVollzeit"),
    partTime: PART_TIME_FIELDS.some((key) => flag(detail, item, key)),
    permanent: contract(detail, item),
    tempAgency: detail.istArbeitnehmerUeberlassung === true,
    description: plainText(detail.stellenangebotsBeschreibung)
  }
}

function searchTerm(filters) {
  const query = String(filters.query || "").trim()
  if (query) return query
  return (filters.roles || []).map((role) => String(role || "").trim()).filter(Boolean).join(" ")
}

function termsFor(filters) {
  const seen = new Set()
  const terms = []
  const add = (term) => {
    const clean = String(term || "").trim()
    const key = clean.toLowerCase()
    if (!key || seen.has(key) || terms.length >= 5) return
    seen.add(key)
    terms.push(clean)
  }
  add(searchTerm(filters))
  for (const term of filters.expansion || []) add(term)
  return terms
}

function mergeFair(lists, limit) {
  const seen = new Set()
  const items = []
  let index = 0
  let added = true
  while (added && items.length < limit) {
    added = false
    for (const list of lists) {
      const item = list[index]
      if (!item?.referenznummer) continue
      added = true
      if (seen.has(item.referenznummer)) continue
      seen.add(item.referenznummer)
      items.push(item)
      if (items.length >= limit) break
    }
    index += 1
  }
  return items
}

async function searchCity(filters, city, term, page) {
  const params = new URLSearchParams({
    angebotsart: "1",
    size: String(PAGE),
    page: String(page)
  })
  if (term) params.set("was", term)
  // PRE-FILTER: Ort, Umkreis und Arbeitszeit begrenzen die Menge, bevor etwas verglichen wird.
  if (city) {
    params.set("wo", city)
    if (filters.radiusKm) params.set("umkreis", String(filters.radiusKm))
  }
  if (filters.maxAgeHours) {
    params.set("veroeffentlichtseit", String(Math.max(1, Math.ceil(filters.maxAgeHours / 24))))
  }
  if (filters.employment === "part-time") params.set("arbeitszeit", "tz")
  if (filters.employment === "full-time") params.set("arbeitszeit", "vz")
  if (filters.permanent === true) params.set("befristung", "2")
  if (filters.permanent === false) params.set("befristung", "1")
  if (filters.excludeTempAgency) params.set("zeitarbeit", "false")
  return getJson("/pc/v6/jobs?" + params)
}

async function loadDetails(item) {
  const code = encodeURIComponent(Buffer.from(item.referenznummer).toString("base64"))
  try {
    const detail = await getJson("/pc/v4/jobdetails/" + code)
    return toJob(item, detail)
  } catch {
    return toJob(item, {})
  }
}

async function placeName(filters, city, term) {
  const state = canonicalState(city)
  if (state) return state
  const names = await namesFor(city)
  if (!filters.radiusKm) return names[0]
  for (const name of names) {
    if (!active()) return names[0]
    const list = await searchCity(filters, name, term, 1)
    const near = (list.ergebnisliste || []).filter((item) => Number(item.entfernung) <= filters.radiusKm)
    if (near.length) return name
  }
  return names[0]
}

async function load(items) {
  if (!items.length || !active()) return []
  log(items.length + " Anzeigen, Details werden geladen")
  const jobs = []
  for (let index = 0; index < items.length; index += 8) {
    if (!active()) break
    const part = items.slice(index, index + 8)
    jobs.push(...await Promise.all(part.map(loadDetails)))
    log("Details " + jobs.length + " von " + items.length)
  }
  return jobs
}

async function listings(filters) {
  const terms = termsFor(filters)
  const term = terms[0] || ""
  const named = (filters.locations || []).filter(Boolean)
  const townsOnly = towns(named)
  const places = townsOnly.length ? townsOnly : named.map((place) => canonicalState(place) || place)
  const cities = places.length ? places : (!named.length || filters.locationAny ? [null] : [])
  const where = places.join(", ")
  const open = !term && (
    filters.salaryMin != null || filters.salaryMax != null || filters.locationAny
    || filters.remote === "required" || filters.remote === "allowed" || filters.remote === "onsite"
    || filters.employment || filters.permanent != null || filters.maxAgeHours || filters.excludeTempAgency
  )
  log("Suche: " + (terms.join(", ") || "kein Begriff") + (where ? " · " + where : ""))
  if ((!term && !open) || !cities.length || !active()) return { items: [], total: 0 }
  const words = terms.length ? terms : [""]
  const lists = []
  let total = 0
  for (const city of cities) {
    if (!active()) break
    const name = city ? await placeName(filters, city, term) : null
    for (const word of words) {
      if (!active()) break
      const list = await searchCity(filters, name, word, 1)
      const batch = list.ergebnisliste || []
      total += Number(list.maxErgebnisse) || batch.length
      log("Seite 1 · " + (word || "kein Begriff") + (name ? " · " + name : "") + ": " + batch.length + ", gelesen werden " + PAGE)
      if (name && !batch.length) log(name + ": keine Anzeigen")
      lists.push(batch)
    }
  }
  return { items: mergeFair(lists, PAGE), total }
}

module.exports = { id: "arbeitsagentur", listings, load }
