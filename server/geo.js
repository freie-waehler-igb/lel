const { getDistance } = require("geolib")

const STATE_CANON = [
  ["baden württemberg", "Baden-Württemberg"],
  ["baden wuerttemberg", "Baden-Württemberg"],
  ["mecklenburg vorpommern", "Mecklenburg-Vorpommern"],
  ["nordrhein westfalen", "Nordrhein-Westfalen"],
  ["rheinland pfalz", "Rheinland-Pfalz"],
  ["sachsen anhalt", "Sachsen-Anhalt"],
  ["schleswig holstein", "Schleswig-Holstein"],
  ["niedersachsen", "Niedersachsen"],
  ["thüringen", "Thüringen"],
  ["thueringen", "Thüringen"],
  ["brandenburg", "Brandenburg"],
  ["saarland", "Saarland"],
  ["sachsen", "Sachsen"],
  ["hamburg", "Hamburg"],
  ["bremen", "Bremen"],
  ["berlin", "Berlin"],
  ["hessen", "Hessen"],
  ["bayern", "Bayern"]
]

const cache = new Map()
let queue = Promise.resolve()

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function flatPlace(name) {
  return String(name || "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ")
}

function canonicalState(name) {
  const key = flatPlace(name)
  const hit = STATE_CANON.find(([probe]) => probe === key)
  return hit ? hit[1] : null
}

function isState(name) {
  return Boolean(canonicalState(name))
}

function statesIn(text) {
  let rest = " " + flatPlace(text) + " "
  const found = []
  for (const [probe, label] of STATE_CANON) {
    const needle = " " + probe + " "
    if (!rest.includes(needle)) continue
    if (!found.includes(label)) found.push(label)
    rest = rest.split(needle).join(" ")
  }
  return found
}

function towns(locations) {
  return (locations || []).filter((place) => place && !isState(place))
}

function isNationwide(name) {
  return /^(?:deutschland|germany|bundesweit|bundesgebiet|bundesrepublik(?:\s+deutschland)?|de)$/i.test(String(name || "").trim())
}

function mentionsNationwide(text) {
  const source = String(text || "")
  if (/\b(?:deutschland|germany|bundesweit|bundesgebiet)\b/i.test(source)) return true
  return /\b(?:in|nach)\s+de\b/i.test(source)
}

function radiusMention(text) {
  const match = String(text || "").match(/(\d{1,3})\s*km\b/i)
  if (!match) return null
  const numeric = Number(match[1])
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) return null
  return numeric
}

function tidyPlace(raw) {
  const words = String(raw || "").trim().replace(/[.,;:!?]+$/g, "").split(/\s+/).filter(Boolean)
  if (!words.length) return ""
  return words.map((word, index) => {
    const bare = word.replace(/[.,;:!?]+$/g, "")
    if (/^sankt$/i.test(bare)) return "Sankt"
    if (/^st\.?$/i.test(bare)) return "St."
    if (index > 0 && /^(am|an|der|im|von|und)$/i.test(bare)) return bare.toLowerCase()
    return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()
  }).join(" ")
}

function placeAround(text) {
  const source = String(text || "")
  const patterns = [
    /\b(?:um|rund um|nahe|bei)\s+([a-zäöüß][\p{L}.-]+(?:\s+[a-zäöüß][\p{L}.-]+){0,3})/iu,
    /\b(?:in|aus)\s+([a-zäöüß][\p{L}.-]+(?:\s+[a-zäöüß][\p{L}.-]+){0,3})/iu
  ]
  for (const pattern of patterns) {
    const match = source.match(pattern)
    if (!match) continue
    const words = []
    for (const word of match[1].split(/\s+/)) {
      if (/^(oder|und|or|and|remote|hybrid|homeoffice|home|office)$/i.test(word)) break
      words.push(word)
      if (words.length >= 4) break
    }
    const place = tidyPlace(words.join(" "))
    if (!place || place.length < 3 || isNationwide(place) || isState(place)) continue
    if (/^(der|die|das|dem|den|wenn|falls|de)$/i.test(place)) continue
    return place
  }
  return ""
}

function townNamed(text) {
  const match = String(text || "").match(/\b((?:sankt|st\.?)\s+[a-zäöüß][\p{L}-]+)/iu)
  if (!match) return ""
  const place = tidyPlace(match[1])
  if (!place || isNationwide(place) || isState(place)) return ""
  return place
}

// Remote in ganz Deutschland und hybrid im Umkreis sind zwei Bedingungen, kein einzelner Ort.
function compoundWork(text) {
  const source = String(text || "")
  const remote = /\b(?:remote|home\s*-?\s*office|homeoffice)\b/i.test(source)
  const hybrid = /\bhybrid\b/i.test(source)
  const radius = radiusMention(source)
  const city = placeAround(source) || townNamed(source)
  if (!(remote && hybrid && mentionsNationwide(source) && radius && city)) return null
  return { city, radius }
}

function closestKm(points, center) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return null
  let best = null
  for (const point of points || []) {
    const lat = Number(point?.lat ?? point?.breite)
    const lon = Number(point?.lon ?? point?.laenge)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const km = getDistance(
      { latitude: center.lat, longitude: center.lon },
      { latitude: lat, longitude: lon }
    ) / 1000
    if (best == null || km < best) best = km
  }
  return best
}

function locate(name) {
  const key = String(name || "").trim().toLowerCase()
  if (!key || isState(name)) return Promise.resolve(null)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  const run = queue.then(() => fetchPlace(key, name))
  queue = run.then(() => pause(1100), () => pause(1100))
  return run
}

async function fetchPlace(key, name) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search")
    url.searchParams.set("q", name + ", Deutschland")
    url.searchParams.set("format", "jsonv2")
    url.searchParams.set("addressdetails", "1")
    url.searchParams.set("limit", "1")
    url.searchParams.set("countrycodes", "de")
    const response = await fetch(url, {
      headers: {
        "User-Agent": "conversational-job-search/1.0",
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return null
    const [hit] = await response.json()
    if (!hit) {
      cache.set(key, null)
      return null
    }
    const address = hit.address || {}
    const place = {
      label: address.city || address.town || address.village || address.municipality || name,
      lat: Number(hit.lat),
      lon: Number(hit.lon)
    }
    cache.set(key, place)
    return place
  } catch (error) {
    console.error("Ort:", error.message)
    return null
  }
}

async function namesFor(city) {
  const names = []
  const add = (value) => {
    const text = String(value || "").trim()
    if (text && !names.some((item) => item.toLowerCase() === text.toLowerCase())) names.push(text)
  }
  add(city)
  if (/^sankt\s+/i.test(city)) add(String(city).replace(/^sankt\s+/i, "St. "))
  const place = await locate(city)
  if (place) add(place.label)
  return names
}

function inside(job, centers, radiusKm) {
  const points = job.coordinates || []
  if (!points.length || !centers.length) return false
  const limit = radiusKm * 1000
  return points.some((point) => centers.some((center) => getDistance(
    { latitude: center.lat, longitude: center.lon },
    { latitude: point.lat, longitude: point.lon }
  ) <= limit))
}

module.exports = {
  locate,
  isState,
  canonicalState,
  statesIn,
  towns,
  namesFor,
  inside,
  isNationwide,
  mentionsNationwide,
  radiusMention,
  tidyPlace,
  placeAround,
  townNamed,
  compoundWork,
  closestKm
}
