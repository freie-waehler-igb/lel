const path = require("path")
const { createWorker } = require("tesseract.js")
const { log, active } = require("./log")

function within(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

let workerPromise

function worker() {
  if (!workerPromise) {
    workerPromise = createWorker("deu+eng", 1, {
      cachePath: path.join(__dirname, "../.tesseract")
    })
  }
  return workerPromise
}

function kind(type, body) {
  const head = body.subarray(0, 16)
  if (type.includes("pdf") || body.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf"
  if (head[0] === 0xff && head[1] === 0xd8) return "image"
  if (head[0] === 0x89 && head.toString("latin1", 1, 4) === "PNG") return "image"
  if (head.toString("latin1", 0, 4) === "GIF8") return "image"
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "image"
  if ((head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d)) return "image"
  return "text"
}

async function ocrImage(bytes) {
  const engine = await worker()
  const result = await engine.recognize(Buffer.from(bytes))
  return result.data.text || ""
}

async function pdfPages(body) {
  if (!active()) return ""
  log("PDF-Renderer startet")
  const mupdf = await within(import("mupdf"), 15000, "Der PDF-Renderer hat zu lange gebraucht.")
  const doc = mupdf.Document.openDocument(body, "application/pdf")
  const count = Math.min(doc.countPages(), 2)
  const parts = []
  for (let index = 0; index < count; index += 1) {
    if (!active()) break
    log("PDF Seite " + (index + 1) + " von " + count)
    const page = doc.loadPage(index)
    const embedded = page.toStructuredText("preserve-whitespace").asText() || ""
    if (embedded.replace(/\s+/g, "").length >= 40) {
      parts.push(embedded)
      continue
    }
    log("Seite " + (index + 1) + " ist ein Scan, Texterkennung")
    const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false)
    parts.push(await within(ocrImage(pixmap.asPNG()), 40000, "Die Texterkennung hat zu lange gebraucht."))
  }
  return parts.join("\n")
}

async function readFile(body, type) {
  if (!active()) return ""
  const mode = kind(String(type || ""), body)
  log("Datei empfangen, " + body.length + " Bytes, " + mode)
  let text = ""
  if (mode === "image") {
    log("Bild wird gelesen")
    text = await within(ocrImage(body), 40000, "Die Texterkennung hat zu lange gebraucht.")
  } else if (mode === "pdf") {
    log("PDF-Textschicht wird gelesen")
    try {
      const parsed = await within(require("pdf-parse")(body), 15000, "Die PDF-Textschicht hat zu lange gebraucht.")
      text = parsed.text || ""
    } catch (error) {
      log(error.message)
    }
    log("Textschicht: " + text.replace(/\s+/g, "").length + " Zeichen")
    if (text.replace(/\s+/g, "").length < 40) text = await pdfPages(body)
  } else {
    text = body.toString("utf8")
    log("Textdatei, " + text.length + " Zeichen")
  }
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 8000)
  log(clean ? "Datei gelesen, " + clean.length + " Zeichen" : "In der Datei war kein Text")
  return clean
}

module.exports = { readFile }
