function unrelatedTitle(title) {
  const text = String(title || "").toLowerCase()
  if (/\b(ux|ui)\b/i.test(text)) return false
  return /\b(backend|warehouse|lager(?:ist|arbeiter)?|pflege|krankenpflege|altenpflege|electrical|electronics|elektronik|elektriker|mechanical|mechanik|maschinenbau|structural|konstrukteur|konstruktion|fahrzeug|automotive|analog|pcb|security engineer|industrial engineer|cloud platform|platform engineer|verification|embedded|firmware|hardware|certification engineer|bim|cad designer|systemplaner|technischer zeichner|technischer produktdesigner|grafikdesigner|grafiker|merchandiser|montagemitarbeiter|werbetechniker|administrator|softwareentwickler|softwarearchitekt|motion designer)\b/i.test(text)
}

function clearDesignTitle(title) {
  const text = String(title || "").toLowerCase()
  if (unrelatedTitle(text)) return false
  if (/\b(ux|ui)\b/i.test(text)) return true
  if (/product\s*-?\s*designer|produktdesigner|product\s*-?\s*design|experience designer/.test(text)) return true
  if (/\bdesign engineer\b/.test(text)) return true
  return false
}

function designSearch(filters) {
  const blob = [
    ...(filters?.roles || []),
    ...(filters?.aliases || []),
    ...(filters?.expansion || []),
    filters?.query || "",
    filters?.intent || ""
  ].join(" ").toLowerCase()
  return /product designer|design engineer|ux designer|ui designer|produktdesigner|product design/.test(blob)
}

function fullyRemoteText(text) {
  const flat = String(text || "").toLowerCase().replace(/\s+/g, " ")
  if (/100\s*%[^.]{0,80}(?:home-?office|homeoffice|remote)/.test(flat)) return true
  if (/(?:home-?office|homeoffice)[^.]{0,40}100\s*%/.test(flat)) return true
  if (/vollständig(?:e[rsnm])?\s+remote|vollstaendig(?:e[rsnm])?\s+remote|fully remote/.test(flat)) return true
  if (/remote[- ](?:first|only)/.test(flat)) return true
  return false
}

module.exports = { unrelatedTitle, clearDesignTitle, designSearch, fullyRemoteText }
