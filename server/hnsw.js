const M = 8
const EF_CONSTRUCTION = 32
const EF_SEARCH = 64
const LEVEL_SCALE = 1 / Math.log(M)

function normalize(vector) {
  let norm = 0
  for (const value of vector) norm += value * value
  norm = Math.sqrt(norm) || 1
  return vector.map((value) => value / norm)
}

function cosine(left, right) {
  let score = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) score += left[index] * right[index]
  return score
}

class HnswIndex {
  constructor() {
    this.entry = null
    this.nodes = new Map()
  }

  add(id, vector) {
    const level = Math.floor(-Math.log(Math.random() || 1e-9) * LEVEL_SCALE)
    const node = { id, vector, level, links: Array.from({ length: level + 1 }, () => []) }
    this.nodes.set(id, node)
    if (!this.entry) {
      this.entry = node
      return
    }
    let current = this.entry
    for (let layer = this.entry.level; layer > level; layer -= 1) current = this.nearest(current, vector, layer)
    for (let layer = Math.min(level, this.entry.level); layer >= 0; layer -= 1) {
      const nearest = this.searchLayer(current, vector, EF_CONSTRUCTION, layer)
      const selected = nearest.slice(0, M)
      node.links[layer] = selected.map((item) => item.id)
      for (const item of selected) {
        const other = this.nodes.get(item.id)
        const links = other.links[layer] || (other.links[layer] = [])
        links.push(id)
        if (links.length > M) {
          const ranked = links
            .map((link) => ({ id: link, score: cosine(other.vector, this.nodes.get(link).vector) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, M)
          other.links[layer] = ranked.map((entry) => entry.id)
        }
      }
      if (nearest[0]) current = this.nodes.get(nearest[0].id) || current
    }
    if (level > this.entry.level) this.entry = node
    this.nodes.set(id, node)
  }

  // HNSW: alle Nachbarn über der Schwelle, kein festes Top-K
  search(vector, threshold) {
    if (!this.entry) return []
    let current = this.entry
    for (let layer = this.entry.level; layer > 0; layer -= 1) current = this.nearest(current, vector, layer)
    return this.searchLayer(current, vector, EF_SEARCH, 0).filter((item) => item.score >= threshold)
  }

  nearest(start, vector, layer) {
    let current = start
    let improved = true
    while (improved) {
      improved = false
      let best = cosine(current.vector, vector)
      for (const link of current.links[layer] || []) {
        const other = this.nodes.get(link)
        if (!other) continue
        const score = cosine(other.vector, vector)
        if (score > best) {
          best = score
          current = other
          improved = true
        }
      }
    }
    return current
  }

  searchLayer(start, vector, ef, layer) {
    const visited = new Set([start.id])
    const candidates = [{ id: start.id, score: cosine(start.vector, vector) }]
    const best = [{ id: start.id, score: candidates[0].score }]
    while (candidates.length) {
      candidates.sort((a, b) => b.score - a.score)
      best.sort((a, b) => b.score - a.score)
      const current = candidates.shift()
      if (best.length >= ef && current.score < best[best.length - 1].score) break
      const node = this.nodes.get(current.id)
      for (const link of node?.links[layer] || []) {
        if (visited.has(link)) continue
        visited.add(link)
        const other = this.nodes.get(link)
        if (!other) continue
        const score = cosine(other.vector, vector)
        if (best.length < ef || score > best[best.length - 1].score) {
          candidates.push({ id: link, score })
          best.push({ id: link, score })
          best.sort((a, b) => b.score - a.score)
          if (best.length > ef) best.pop()
        }
      }
    }
    return best.sort((a, b) => b.score - a.score)
  }
}

module.exports = { HnswIndex, normalize, cosine }
