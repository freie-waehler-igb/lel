const { AsyncLocalStorage } = require("node:async_hooks")

const lines = []
const runs = new AsyncLocalStorage()
let nextId = 0
let generation = 1

function active() {
  const mine = runs.getStore()
  return mine == null || mine === generation
}

function bind(work) {
  return runs.run(generation, work)
}

function end() {
  generation += 1
  lines.length = 0
}

function log(message) {
  if (!active()) return null
  nextId += 1
  const entry = {
    id: nextId,
    at: new Date().toLocaleTimeString("de-DE", { hour12: false }),
    message: String(message)
  }
  lines.push(entry)
  if (lines.length > 300) lines.shift()
  console.log(entry.at, entry.message)
  return entry
}

function since(after) {
  const id = Number(after) || 0
  return lines.filter((line) => line.id > id)
}

module.exports = { log, since, end, bind, active }
