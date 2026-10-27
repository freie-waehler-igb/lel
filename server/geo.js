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

module.exports = { locate, isState, canonicalState, statesIn, towns, namesFor, inside }
