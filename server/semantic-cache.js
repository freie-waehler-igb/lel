const { HnswIndex, normalize } = require("./hnsw")

const THRESHOLD = 0.95
const LIMIT = 128

function signature(filters) {
  const list = (filters.locations || []).map((place) => String(place).toLowerCase()).sort()
  return JSON.stringify({
    locations: list,
    radiusKm: filters.radiusKm || null,
    remote: filters.remote || "unspecified",
    employment: filters.employment || null,
    permanent: filters.permanent ?? null,
    salaryMin: filters.salaryMin || null,
    salaryMax: filters.salaryMax || null,
    locationAny: Boolean(filters.locationAny),
    maxAgeHours: filters.maxAgeHours || null,
    excludeTempAgency: Boolean(filters.excludeTempAgency),
    alsoFullyRemote: Boolean(filters.alsoFullyRemote),
    context: String(filters.context || "").toLowerCase().slice(0, 180),
    exactTerms: (filters.exactTerms || []).map((term) => String(term).toLowerCase()).sort()
  })
}

function queryText(filters) {
  if (filters.cacheText) return String(filters.cacheText).toLowerCase().replace(/\s+/g, " ").trim()
  return [filters.query, ...(filters.roles || []), ...(filters.expansion || [])]
    .map((term) => String(term || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function hashEmbed(text, dim = 256) {
  const vector = new Array(dim).fill(0)
  const tokens = String(text).toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || []
  for (const token of tokens) {
    const grams = [token]
    for (let index = 0; index < token.length - 2; index += 1) grams.push(token.slice(index, index + 3))
    for (const gram of grams) {
      let hash = 2166136261
      for (let index = 0; index < gram.length; index += 1) {
        hash ^= gram.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      const slot = Math.abs(hash) % dim
      vector[slot] += hash & 1 ? 1 : -1
    }
  }
  return normalize(vector)
}

function createSemanticCache(embed) {
  const buckets = new Map()
  const vectors = new Map()
  let sequence = 0

  async function vectorFor(text) {
    if (vectors.has(text)) return vectors.get(text)
    const vector = embed ? await embed(text) : hashEmbed(text)
    vectors.set(text, vector)
    return vector
  }

  return {
    async find(filters) {
      const text = queryText(filters)
      if (!text) return null
      // PRE-FILTER: nur der Index von Ort, Umkreis und Arbeitsmodell
      const bucket = buckets.get(signature(filters))
      if (!bucket) return null
      const vector = await vectorFor(text)
      // HNSW: Schwelle 0.95, kein lineares Abtasten der gespeicherten Anfragen
      const hits = bucket.index.search(vector, THRESHOLD)
      if (!hits.length) return null
      hits.sort((left, right) => right.score - left.score)
      const hit = bucket.items.get(hits[0].id)
      return hit ? structuredClone(hit) : null
    },
    async store(filters, result) {
      const text = queryText(filters)
      if (!text) return
      const key = signature(filters)
      const bucket = buckets.get(key) || { index: new HnswIndex(), items: new Map() }
      if (bucket.items.size >= LIMIT) return
      const vector = await vectorFor(text)
      const id = String(++sequence)
      bucket.index.add(id, vector)
      bucket.items.set(id, structuredClone(result))
      buckets.set(key, bucket)
    }
  }
}

const semanticCache = createSemanticCache()

module.exports = { semanticCache, createSemanticCache, hashEmbed, signature }
