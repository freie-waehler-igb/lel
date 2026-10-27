function tidyTerm(term) {
  const clean = String(term).trim()
  if (!clean || clean !== clean.toLowerCase()) return clean
  if (clean.length <= 3) return clean.toUpperCase()
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function asStrings(value) {
  if (!Array.isArray(value)) return []
  return value.map(tidyTerm).filter(Boolean)
}

function asMoney(value) {
  if (value == null || value === "") return null
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d]/g, ""))
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  if (numeric < 1000) return Math.round(numeric * 1000)
  return Math.round(numeric)
}

function asHours(value) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 24 * 365) return null
  return numeric
}

function asRadius(value) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) return null
  return numeric
}

function normalizeBranches(value) {
  if (!Array.isArray(value)) return []
  const branches = []
  for (const branch of value) {
    if (!branch || typeof branch !== "object" || branches.length >= 4) continue
    const body = branch.filters && typeof branch.filters === "object" ? branch.filters : null
    if (!body) continue
    const label = String(branch.label || "").trim().slice(0, 180)
    branches.push({
      label,
      filters: normalizeFilters({ ...body, branches: [] })
    })
  }
  return branches
}

function normalizeFilters(filters) {
  const source = filters && typeof filters === "object" ? filters : {}
  const remote = ["required", "allowed", "unspecified", "onsite"].includes(source.remote)
    ? source.remote
    : "unspecified"
  const employment = source.employment === "full-time" || source.employment === "part-time"
    ? source.employment
    : null
  return {
    roles: asStrings(source.roles),
    skills: asStrings(source.skills),
    keywords: asStrings(source.keywords),
    locations: asStrings(source.locations),
    remote,
    salaryMin: asMoney(source.salaryMin),
    salaryMax: asMoney(source.salaryMax),
    employment,
    permanent: typeof source.permanent === "boolean" ? source.permanent : null,
    excludeTempAgency: Boolean(source.excludeTempAgency),
    excludeTerms: asStrings(source.excludeTerms),
    locationAny: Boolean(source.locationAny),
    aliases: asStrings(source.aliases),
    intent: String(source.intent || "").trim().slice(0, 400),
    query: String(source.query || "").trim().slice(0, 200),
    expansion: asStrings(source.expansion).slice(0, 8),
    exactTerms: asStrings(source.exactTerms).slice(0, 12),
    radiusKm: asRadius(source.radiusKm),
    maxAgeHours: asHours(source.maxAgeHours),
    alsoFullyRemote: Boolean(source.alsoFullyRemote),
    hybrid: source.hybrid === true,
    branches: normalizeBranches(source.branches)
  }
}

function hasAnchor(filters) {
  return Boolean(
    filters.roles.length || filters.skills.length || filters.keywords.length || filters.locations.length
  )
}

function hasConstraint(filters) {
  return Boolean(
    filters.salaryMin != null
    || filters.salaryMax != null
    || filters.locationAny
    || filters.locations.length
    || filters.remote === "required"
    || filters.remote === "allowed"
    || filters.remote === "onsite"
    || filters.employment
    || filters.permanent != null
    || filters.maxAgeHours
    || filters.radiusKm
    || filters.excludeTempAgency
    || (filters.excludeTerms || []).length
    || filters.hybrid
    || filters.alsoFullyRemote
  )
}

module.exports = {
  normalizeFilters,
  hasAnchor,
  hasConstraint
}
