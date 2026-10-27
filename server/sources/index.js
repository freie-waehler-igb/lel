const arbeitsagentur = require("./arbeitsagentur")

const sources = [arbeitsagentur]

async function listings(filters) {
  const batches = await Promise.all(sources.map((source) => source.listings(filters)))
  const seen = new Set()
  const items = []
  let total = 0
  for (const batch of batches) {
    total += batch.total
    for (const item of batch.items) {
      if (!item?.referenznummer || seen.has(item.referenznummer)) continue
      seen.add(item.referenznummer)
      items.push(item)
    }
  }
  return { items, total }
}

async function load(items) {
  if (!items.length) return []
  const jobs = []
  for (const source of sources) jobs.push(...await source.load(items))
  return jobs
}

module.exports = { listings, load }
