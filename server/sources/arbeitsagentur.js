const { namesFor, towns, canonicalState, locate, closestKm } = require("../geo")
const { log, active } = require("../log")
const { clearDesignTitle, designSearch, unrelatedTitle } = require("../titles")

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
    if (!key || seen.has(key) || terms.length >= 8) return
    seen.add(key)
    terms.push(clean)
  }
  const roles = (filters.roles || []).map((role) => String(role || "").trim()).filter(Boolean)
  if (roles.length) {
    for (const role of roles) add(role)
  } else {
    add(searchTerm(filters))
  }
  for (const alias of filters.aliases || []) add(alias)
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

function listingKm(item, center) {
  return closestKm(item?.stellenlokationen || [], center)
}

function inRadius(item, center, radiusKm) {
  const km = listingKm(item, center)
  if (km != null) return km <= radiusKm
  const agency = Number(item?.entfernung)
  return Number.isFinite(agency) && agency <= radiusKm
}

function rankListing(item, filters) {
  const title = String(item?.stellenangebotsTitel || "")
  let score = 0
  if (unrelatedTitle(title)) score -= 20
  if (clearDesignTitle(title)) score += 10
  if (filters.remote === "required" && /home[\s-]*office|remote/i.test(title)) score += 6
  if (filters.remote === "required" && item?.homeofficemoeglich === true) score += 2
  return score
}

async function radiusBatch(filters, city, word, center) {
  const names = await namesFor(city)
  let bestName = names[0]
  let bestRows = []
  let bestOutside = 0
  for (const name of names) {
    if (!active()) break
    const list = await searchCity(filters, name, word, 1)
    const rows = list.ergebnisliste || []
    const near = []
    let outside = 0
    for (const item of rows) {
      if (inRadius(item, center, filters.radiusKm)) near.push(item)
      else outside += 1
    }
    log(word + " · " + name + ": " + near.length + " im Umkreis, " + outside + " außerhalb")
    if (near.length > bestRows.length) {
      bestName = name
      bestRows = near
      bestOutside = outside
    }
  }
  if (bestRows.length) log("Ort gewählt: " + bestName + " · " + bestRows.length + " behalten, " + bestOutside + " außerhalb")
  return bestRows
}

async function listings(filters) {
  const terms = termsFor(filters)
  const term = terms[0] || ""
  const named = (filters.locations || []).filter(Boolean)
  const townsOnly = towns(named)
  const places = townsOnly.length ? townsOnly : named.map((place) => canonicalState(place) || place)
  const cities = places.length ? places : (!named.length || filters.locationAny ? [null] : [])
  const where = places.join(", ") || (filters.locationAny ? "bundesweit" : "")
  const mode = filters.remote === "required" ? "remote" : filters.hybrid ? "hybrid" : ""
  const open = !term && (
    filters.salaryMin != null || filters.salaryMax != null || filters.locationAny
    || filters.remote === "required" || filters.remote === "allowed" || filters.remote === "onsite"
    || filters.employment || filters.permanent != null || filters.maxAgeHours || filters.excludeTempAgency
  )
  log("Suche: " + (terms.join(", ") || "kein Begriff") + (mode ? " · " + mode : "") + (where ? " · " + where : ""))
  if ((!term && !open) || !cities.length || !active()) return { items: [], total: 0 }
  const words = terms.length ? terms : [""]
  const lists = []
  let total = 0
  const design = designSearch(filters)
  for (const city of cities) {
    if (!active()) break
    const center = city && filters.radiusKm ? await locate(city) : null
    const name = city && !filters.radiusKm ? await placeName(filters, city, term) : null
    for (const word of words) {
      if (!active()) break
      if (city && filters.radiusKm) {
        const near = await radiusBatch(filters, city, word, center)
        total += near.length
        lists.push(near)
        continue
      }
      const pages = filters.remote === "required" ? [1, 2] : [1]
      const batch = []
      let reported = 0
      for (const page of pages) {
        if (!active()) break
        const list = await searchCity(filters, name, word, page)
        const rows = list.ergebnisliste || []
        reported = Number(list.maxErgebnisse) || reported
        batch.push(...rows)
        log("Seite " + page + " · " + (word || "kein Begriff") + (name ? " · " + name : "") + ": " + rows.length + ", gelesen werden " + PAGE)
        if (rows.length < PAGE) break
      }
      total += reported || batch.length
      if (name && !batch.length) log(name + ": keine Anzeigen")
      lists.push(batch)
    }
  }
  const prepared = lists.map((list) => {
    if (!design) return list
    return list
      .filter((item) => clearDesignTitle(item.stellenangebotsTitel))
      .sort((left, right) => rankListing(right, filters) - rankListing(left, filters))
  })
  const merged = mergeFair(prepared, design ? 36 : PAGE)
  const items = design
    ? merged
      .sort((left, right) => rankListing(right, filters) - rankListing(left, filters))
      .slice(0, filters.remote === "required" ? 12 : 16)
    : merged
  if (design) log("Passende Titel: " + items.length)
  return { items, total }
}

module.exports = { id: "arbeitsagentur", listings, load }
