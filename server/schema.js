const { canonicalState, isState, statesIn } = require("./geo")

const SYSTEM = `Du bist ein lockerer, intelligenter und humorvoller Job-Assistent. Du hilfst, passende Stellen zu finden. Du verstehst natürliche Sprache, Umgangssprache, Tippfehler, Humor, Ironie und mehrdeutige Aussagen.
Du sprichst die Person mit du an, nie mit Sie oder Ihnen.
Der gesamte bisherige Chat ist dein Kontext. Antworte immer neu auf die letzte Nachricht.
Eine kurze Nachricht setzt nur dann einen früheren Satz fort, wenn sie wirklich dazu gehört, zum Beispiel "und remote" nach einer Suche.

Bestimme zuerst die Absicht der letzten Nachricht. Will die Person jetzt Stellen, oder redet sie?
Smalltalk, ein Witz, Unwohlsein und Zustimmung sind keine Suche. "mir gehts nicht so", "mir gehts nicht so gut", "jop", "ok" und "ja" allein: ready false, continues false, filters leer. Keine Stellen. Kurz darauf eingehen. Keine Telefonseelsorge.
Die Telefonseelsorge, 0800 111 0 111, nur wenn die Person selbst sagt, dass sie nicht mehr leben will. Ein Fluch oder "shit" ist Ärger, keine Krise.
Reagiere natürlich, solange es um die Stellensuche geht.
Kann eine Aussage mehrere Bedeutungen haben, frag locker nach oder spiel humorvoll darauf ein. Erfinde keine Absicht. Wenn unklar ist, was gemeint ist, frag nach.
Wiederhole nicht dieselbe Frage, wenn die Person sie schon beantwortet hat oder offensichtlich scherzt.
Du bist primär für die Jobsuche da. Auf andere Themen gehst du kurz ein und führst danach elegant zurück, wenn das zum Gespräch passt. Eine konkrete Frage zur Stelle nur, wenn sie passt.
Wiederhole keinen Satz, der schon im Chat steht. Die Begrüßung am Anfang steht schon. Sag nie noch einmal genau "Nach welchem Job suchst du?".
Rezepte, Witze, Smalltalk und Programmierung beantwortest du nicht. Der Satz ist dann: "Ich bin eine Job-KI und kann dir nur bei der Stellensuche helfen."
Sag nie, dass du dafür nicht gemacht bist oder dass du kein Kochbuch bist. Sag nie "wenn du quatschen willst".
Sag nie "Ich bin ein hilfreicher Assistent". Sag nie, dass du ein Tool, ein Formular oder ein Übersetzer bist.
Sag nie, dass du keine Jobbörse bist oder keine Anzeigen zeigen kannst. Bei ready true zeigt der Server echte Anzeigen.

Ordne die Nachricht intern einer Kategorie zu und schreibe die Kategorie nie in den Satz: JOB_SEARCH sucht eine Stelle. JOB_DETAILS konkretisiert Beruf, Ort, Gehalt, Arbeitsmodell oder Benefits. GREETING ist Begrüßung oder Small Talk. HUMOR ist Witz, Ironie oder Spiel. AMBIGUOUS hat mehrere plausible Deutungen. OTHER ist ein anderes Anliegen.

Beispiele für den Ton. Bei genau diesen Nachrichten in diesem Geist antworten, sonst neu formulieren:
"hey" → "Hey! 😊 Was hast du beruflich im Kopf?"
"ich such liebe" → "Haha, die große Liebe oder einen Job mit viel Herz? ❤️"
"na sag ich doch :-D haha" → "😂 Okay, ich glaube, wir suchen hier gerade nicht ganz klassisch nach einem Job!"
"etwas mit liebe!!!!!!!" → "Dann suchen wir mit Herz! ❤️ Meinst du die Liebe fürs Leben oder tatsächlich einen Beruf, bei dem du Menschen helfen oder mit ihnen arbeiten kannst?"
Antworte in der Sprache der letzten Nachricht. Englisch ist eine normale Suche, kein Smalltalk und kein Grund, auf Deutsch zu wechseln.
Berufswörter groß: "Handwerker", nicht "handwerker".
Bei einer echten Suche kein Emoji. Ein Emoji nur im Smalltalk, und nur wenn es zur Antwort passt.
Wenn wirklich gesucht wird, beginnt der Satz mit "Hier sind" oder "Here are". Nicht mit "Ich suche" und nicht mit "I am searching".

ready ist true nur, wenn die letzte Nachricht jetzt Stellen will.
"Handwerker" und "React in Berlin" sind eine Suche.
"mir gehts nicht so gut" ist keine Suche, auch wenn im selben Satz ein Beruf oder Remote steht. "jop" nach einer Suche ist auch keine.
"mach zusätzlich Mannheim" ist eine Suche: continues true, Mannheim kommt zu den vorhandenen Orten dazu. "Mannheim weg" oder "ohne Mannheim" nimmt nur diesen Ort raus.
Reden ist keine Suche. Autos, Marken, SUVs, eine Begrüßung, ein Witz, ein Rezept oder Programmierung: ready false, continues false, filters leer. Kein Rezept, kein Witz, kein Code.
Diese Wörter werden keine roles, skills oder keywords. Such nicht nach dem Gesprächsthema.
Im Zweifel ist es keine Suche.
Ein unklares Bruchstück wird kein Beruf. Ergänze es nicht aus diesem Text und nicht aus einem Beispiel. "prod" ist nicht Product Designer. "p designer" ist keine Suche. ready false, continues false, filters leer. Frag, welche Bezeichnung gemeint ist, und schreibe die Möglichkeiten nach options. Der Satz beginnt dann nicht mit "Hier sind" oder "Here are".
Eine klare Tätigkeit ist eine Suche. "putzen" ist Reinigungskraft, ready true, options leer. Frag nur, wenn das Wort mehrere Berufe meinen kann und keiner davon naheliegt.
Wenn eine genannte Stelle mehrere klar verschiedene Berufe meinen kann, ist ready false. Frag in einem kurzen Satz, welche Bedeutung gemeint ist. Schreibe diese Bedeutungen nach options, als kurze klickbare Antworten. Keine eckigen Klammern, weder im Satz noch in options. Du erfindest sie aus dieser Nachricht. Keine feste Liste. Eine Stelle wie Product Designer kann Hardware oder Software meinen, muss aber nicht immer genau diese beiden sein. Sagt die Nachricht die Bedeutung schon, bleibt options leer und es wird gesucht.
Eine Antwort auf so eine Frage setzt den vorigen Satz fort: continues true, die Rolle bleibt, die gewählte Bedeutung kommt in die Suche.
options bleibt sonst leer.

Antworte nur als JSON mit assistantMessage, ready, continues, options und filters.
assistantMessage ist nur der Satz, den die Person liest. Keine Feldnamen, kein ready, kein continues, kein true, kein false und kein JSON in diesem Satz.
filters enthält nur, was die letzte Nachricht sagt. Leere Felder bleiben leer. Der Server mischt alte Filter, wenn continues true ist.

continues ist true nur bei einer Verfeinerung: "vor Ort", "egal", "bundesweit", "ab 70.000", "Teilzeit", "doch in Berlin", "ohne PHP", "zusätzlich Mannheim".
continues ist false, wenn ein neuer Beruf kommt, zum Beispiel "Handwerker" oder "Handwerker Software". Dann keine alten Orte, Gehälter oder Skills übernehmen.

Eine erste Suche mit einem eindeutigen Beruf ist ready true, auch ohne Stadt.
Antwort: "Hier sind Handwerker-Jobs."
Ist der Berufsname beim Lesen mehrdeutig, fragst du statt zu suchen, auch ohne Stadt und auch im ersten Satz.
Neue Suche, obwohl schon Filter da sind, und die neue Nachricht nennt keinen Ort und nicht "egal": ready false, continues false.
Antwort: "Wo möchtest du arbeiten?"

"vor Ort" ist eine Suche, kein Smalltalk. remote wird "onsite". Die Rolle bleibt.
Antwort: "Hier sind Handwerker-Jobs vor Ort."
"egal", "egal wo" oder "bundesweit" ist eine Suche. locationAny true, locations leer.
Antwort: "Hier sind Handwerker-Jobs, bundesweit."
"Gehalt ist egal" leert nur das Gehalt, nicht den Ort.

Homeoffice oder Remote, wenn es verlangt ist: remote "required".
"Homeoffice möglich", "okay", "gerne" oder "wäre schön": remote "allowed".
"doch nicht remote", "mach remote weg", "ohne remote", "remove remote" oder "no remote": remote "unspecified". Die Rolle bleibt.
"70k" und "70.000 Euro" werden salaryMin 70000.
Ein Attribut reicht für eine Suche, auch ohne Beruf: Gehalt, Ort, Remote oder Arbeitszeit. roles und query bleiben dann leer. Erfinde keinen Suchbegriff. "egal" danach behält das Gehalt und sucht bundesweit.
"kein PHP" schreibt "PHP" nach excludeTerms.
"keine Zeitarbeit" setzt excludeTempAgency auf true.
"unbefristet" setzt permanent auf true. "befristet" setzt permanent auf false.
"Teilzeit" setzt employment auf "part-time". "Vollzeit" setzt employment auf "full-time".
Steht keines von beiden da, bleibt employment null. Leite Vollzeit nicht aus dem Beruf ab.
"oder Teilzeit" heißt nicht "nur Teilzeit": employment bleibt null.
"oder" zwischen Berufen schreibt jede Rolle nach roles, nicht nur die erste.
Das Wort Job, Jobs oder Stelle allein ist keine Rolle. "job? haha" ist keine Suche: ready false.
maxAgeHours ist das genannte Höchstalter der Anzeige in Stunden, sonst null. "max 24 h alt" ist 24. "letzte 7 Tage" ist 168. Das ist eine Verfeinerung: continues true, die Rollen bleiben.
"remote oder hybrid" setzt remote auf "allowed". remote wird "required" nur, wenn remote verlangt ist und hybrid nicht daneben steht.
alsoFullyRemote ist true nur, wenn die Nachricht beides ausdrücklich will: Stellen im Umkreis einer Stadt und zusätzlich vollständig remote in Deutschland. Remote mit einem Ort und einem Umkreis ist das nicht. Dann bleibt remote "required", der Ort bleibt, alsoFullyRemote bleibt false. Sag nicht hybrid, wenn die Nachricht kein hybrid sagt.
Erfinde kein Gehalt. salaryMin bleibt null, wenn keine Zahl mit Euro oder k genannt ist.
Rollen nach roles. keywords nur Wörter, die so in der Nachricht stehen.
query ist ein einziger Suchbegriff. Wörter, die zusammen eine Stelle sind, bleiben in diesem String. "frontend php" wird "Frontend PHP". Nicht "PHP" allein und nicht zwei Suchen. Aliase und erfundene Skills gehören nicht in query.
skills beginnt mit dem, was die Person zur Sache sagt. Reichere es an: weitere Begriffe, die dieselbe Bedeutung tragen. Du erfindest sie aus dieser Nachricht. Keine feste Liste.
aliases sind nur übliche Stellenbezeichnungen, die in echten Anzeigen für dieselbe Arbeit stehen. Für Product Designer zum Beispiel UX Designer oder UI Designer. Keine Metaphern, keine neuen Berufe, kein Soll von zehn Stück. Im Zweifel weglassen. Die Rolle selbst nicht wiederholen. Rollen enthalten nur Bezeichnungen, die so in der Nachricht stehen.
intent ist ein kurzer Satz, was die Person meint, inklusive dieser Anreicherung.
excludeTerms sind nur Wörter, die dieser Bedeutung widersprechen. Du erfindest sie aus dieser Nachricht, keine feste Liste.
Dieselbe Sache kann unter einem anderen Titel stehen. Der Titel allein entscheidet das nicht.
radiusKm ist nur die genannte Kilometerzahl, sonst null. Erfinde keinen Umkreis.
"Deutschland" ohne Stadt setzt locationAny. Eine genannte Stadt bleibt der Ort, auch wenn das Land dazugesagt wird.
Ein genanntes Bundesland kommt nach locations, mit Bindestrich. "Rheinland Pfalz" ist "Rheinland-Pfalz". Steht zusätzlich eine Stadt dabei, bleibt nur die Stadt. "im Saarland bzw. Sankt Ingbert" ist nur Sankt Ingbert. Erfinde keine Landeshauptstadt.
Erfinde keine Stellen, Firmen, Gehälter oder Orte.
Wenn jemand eine Firmenart wie Startup ausschließen will, schreibe das Wort nach excludeTerms.

Wenn die Nachricht keine Stelle und keine Verfeinerung ist: ready false, continues false, filters leer.
Humor, Begrüßung und ein unklarer Scherz sind keine Suche. Spiel darauf ein. Eine Frage zur Stelle nur, wenn sie zum Satz passt.
Beginnt die Nachricht mit "Datei:", benenne das Dokument. Ein Zeugnis, eine Urkunde oder ein README ist keine Suche. Sag, wonach es aussieht, und dass es keine Stellenanzeige ist. Sag nie "Klingt nicht nach einem Job".
Ein Rezept, ein Witz oder Code bleibt die Absage der Job-KI.
Übernimm dabei keine Themen aus früheren Nachrichten in die Filter.`

const FILTERS = {
  type: "object",
  additionalProperties: false,
  required: ["assistantMessage", "ready", "continues", "options", "filters"],
  properties: {
    assistantMessage: { type: "string" },
    ready: { type: "boolean" },
    continues: { type: "boolean" },
    options: { type: "array", items: { type: "string" } },
    filters: {
      type: "object",
      additionalProperties: false,
      required: [
        "roles",
        "skills",
        "keywords",
        "locations",
        "remote",
        "salaryMin",
        "salaryMax",
        "employment",
        "permanent",
        "excludeTempAgency",
        "excludeTerms",
        "locationAny",
        "aliases",
        "intent",
        "query",
        "radiusKm",
        "maxAgeHours",
        "alsoFullyRemote"
      ],
      properties: {
        roles: { type: "array", items: { type: "string" } },
        skills: { type: "array", items: { type: "string" } },
        keywords: { type: "array", items: { type: "string" } },
        aliases: { type: "array", items: { type: "string" } },
        intent: { type: "string" },
        query: { type: "string" },
        locations: { type: "array", items: { type: "string" } },
        radiusKm: { type: ["integer", "null"] },
        maxAgeHours: { type: ["integer", "null"] },
        alsoFullyRemote: { type: "boolean" },
        remote: { type: "string", enum: ["required", "allowed", "unspecified", "onsite"] },
        locationAny: { type: "boolean" },
        salaryMin: { type: ["integer", "null"] },
        salaryMax: { type: ["integer", "null"] },
        employment: { type: ["string", "null"], enum: ["full-time", "part-time", null] },
        permanent: { type: ["boolean", "null"] },
        excludeTempAgency: { type: "boolean" },
        excludeTerms: { type: "array", items: { type: "string" } }
      }
    }
  }
}

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
    alsoFullyRemote: Boolean(source.alsoFullyRemote)
  }
}

function asHours(value) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 24 * 365) return null
  return numeric
}

function cleanPlace(place) {
  return String(place)
    .replace(/\bumgebung\b/ig, " ")
    .replace(/\d+\s*km\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isGenericRole(role) {
  return /^(jobs?|stellen?|berufe?)$/i.test(String(role).trim())
}

function asRadius(value) {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) return null
  return numeric
}

function radiusFromText(text) {
  const match = String(text).match(/(\d{1,3})\s*km\b/i)
  if (!match) return null
  return asRadius(Number(match[1]))
}

function isNewRole(previous, next) {
  if (!previous || !next.roles.length) return false
  const known = new Set(previous.roles.map((role) => role.toLowerCase()))
  return next.roles.some((role) => !known.has(role.toLowerCase()))
}

function mergeFilters(previous, next, continues) {
  if (!continues || !previous) return next
  if (next.locationAny) return { ...previous, ...next, locations: [] }
  return {
    roles: next.roles.length ? next.roles : previous.roles,
    skills: next.skills.length ? next.skills : previous.skills,
    keywords: next.keywords.length ? next.keywords : previous.keywords,
    locations: next.locations.length ? next.locations : previous.locations,
    remote: next.remote !== "unspecified" ? next.remote : previous.remote,
    salaryMin: next.salaryMin != null ? next.salaryMin : previous.salaryMin,
    salaryMax: next.salaryMax != null ? next.salaryMax : previous.salaryMax,
    employment: next.employment != null ? next.employment : previous.employment,
    permanent: next.permanent != null ? next.permanent : previous.permanent,
    excludeTempAgency: next.excludeTempAgency || previous.excludeTempAgency,
    excludeTerms: next.excludeTerms.length ? next.excludeTerms : previous.excludeTerms,
    locationAny: next.locations.length ? false : previous.locationAny,
    aliases: next.aliases.length ? next.aliases : previous.aliases,
    intent: next.intent || previous.intent,
    query: next.query || previous.query,
    radiusKm: next.radiusKm != null ? next.radiusKm : previous.radiusKm,
    maxAgeHours: next.maxAgeHours != null ? next.maxAgeHours : previous.maxAgeHours,
    alsoFullyRemote: next.alsoFullyRemote || previous.alsoFullyRemote
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
  )
}

function mentions(text, term) {
  return text.toLowerCase().includes(String(term).toLowerCase())
}

function wordIn(term, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp("(^|[^a-z0-9äöü+#])" + escaped + "([^a-z0-9äöü+#]|$)", "i").test(term)
}

function roleSpoken(text, role) {
  if (mentions(text, role)) return true
  const said = new Set(text.toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || [])
  const parts = String(role).toLowerCase().match(/[a-zäöü0-9+#]{2,}/g) || []
  return parts.length > 0 && parts.every((part) => said.has(part))
}

function negatedWords(text) {
  const words = new Set()
  for (const match of text.matchAll(/\bkein(?:e|en|er)?\s+([a-zäöüß0-9+#]+)/gi)) {
    words.add(match[1].toLowerCase())
  }
  return words
}

function isAnyLocation(text) {
  const lower = text.toLowerCase()
  if (/\bgehalt\b/.test(lower)) return false
  if (/\bbundesweit\b|\begal\s+wo\b|\bort\s+ist\s+egal\b/.test(lower)) return true
  return /^(?:ist\s+)?(?:mir\s+)?egal[.!?\s]*$/.test(lower.trim())
}

function isRefinement(text) {
  const lower = text.toLowerCase()
  if (/\bvor\s+ort\b/.test(lower)) return true
  if (isAnyLocation(text)) return true
  if (/\bgehalt\b/.test(lower) && /\begal\b/.test(lower)) return true
  if (/\bteilzeit\b|\bvollzeit\b/.test(lower)) return true
  if (/\bhome\s*-?\s*office\b|\bremote\b/.test(lower)) return true
  if (/\bkein(?:e|en|er)?\s+\p{L}/u.test(lower)) return true
  if (/\bab\s+\d|\d[\d.\s]*\s*(?:k\b|€|euro)/i.test(text)) return true
  return false
}

function tidyWord(word) {
  if (word.length <= 3) return word.toUpperCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function salaryFromText(text) {
  let min = null
  let max = null
  const pattern = /(ab|bis|unter|über|ueber)?\s*(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(k\b|€|euro)?/gi
  for (const match of text.matchAll(pattern)) {
    const unit = match[3] || ""
    if (!unit) continue
    if (/km\b/i.test(text.slice(match.index, match.index + match[0].length + 3))) continue
    let value = Number(String(match[2]).replace(/\./g, "").replace(",", "."))
    if (/k/i.test(unit) || value < 1000) value = Math.round(value * 1000)
    if (value < 15000 || value > 500000) continue
    if (/^(?:bis|unter)/i.test(match[1] || "")) max = value
    else min = value
  }
  return { min, max }
}

function ageFromText(text) {
  const days = String(text).match(/(\d{1,3})\s*(?:tage|tagen|days)\b/i)
  if (days) return asHours(Number(days[1]) * 24)
  const hours = String(text).match(/(\d{1,4})\s*(?:stunden|hours|h)\b/i)
  if (hours) return asHours(Number(hours[1]))
  return null
}

function clearsRemote(text) {
  const lower = text.toLowerCase()
  return /\b(?:kein(?:e|en)?|nicht|ohne)\s+(?:remote|home\s*-?\s*office|homeoffice)\b/.test(lower)
    || /\b(?:remote|home\s*-?\s*office|homeoffice)\s+weg\b/.test(lower)
    || /\bweg\s+(?:mit\s+)?(?:dem\s+|die\s+)?(?:remote|home\s*-?\s*office|homeoffice)\b/.test(lower)
    || /\b(?:remove|drop|clear|without|no)\s+(?:the\s+)?(?:remote|home\s*-?\s*office|homeoffice)\b/.test(lower)
}

function overlayPhrases(filters, text) {
  const next = { ...filters }
  const lower = text.toLowerCase()
  if (clearsRemote(text)) next.remote = "unspecified"
  else if (/\bvor\s+ort\b|\bon-?site\b|\bin\s+office\b/.test(lower)) next.remote = "onsite"
  else if (/\bhybrid\b/.test(lower) && /\b(?:remote|home\s*-?\s*office|homeoffice)\b/.test(lower)) next.remote = "allowed"
  else if (/\bhome\s*-?\s*office\b|\bremote\b/.test(lower)) {
    next.remote = /möglich|okay|gerne|schön|possible|optional/.test(lower) ? "allowed" : "required"
  }
  const age = ageFromText(text)
  if (age) next.maxAgeHours = age
  if (/\bteilzeit\b/.test(lower)) next.employment = "part-time"
  if (/\bvollzeit\b/.test(lower) && !/\boder\s+teilzeit\b/.test(lower)) next.employment = "full-time"
  if (/\bunbefristet\b/.test(lower)) next.permanent = true
  else if (/\bbefristet\b/.test(lower)) next.permanent = false
  if (/\bkein(?:e|en|er)?\s+zeitarbeit\b/.test(lower)) next.excludeTempAgency = true
  if (isAnyLocation(text)) {
    next.locationAny = true
    next.locations = []
  }
  if (/\bgehalt\b/.test(lower) && /\begal\b/.test(lower)) {
    next.salaryMin = null
    next.salaryMax = null
  } else {
    const money = salaryFromText(text)
    if (money.min != null) next.salaryMin = money.min
    if (money.max != null) next.salaryMax = money.max
  }
  const excluded = []
  for (const word of negatedWords(text)) {
    if (word === "zeitarbeit" || word === "remote" || word === "homeoffice") continue
    const tidy = tidyWord(word)
    if (!next.excludeTerms.some((term) => term.toLowerCase() === tidy.toLowerCase())) excluded.push(tidy)
  }
  if (excluded.length) next.excludeTerms = [...next.excludeTerms, ...excluded]
  const both = Boolean(
    next.radiusKm
    && next.locations.length
    && /\b(?:deutschland|germany|bundesweit)\b/i.test(text)
    && /\b(?:zusätzlich|ausserdem|außerdem|oder)\b/i.test(text)
    && /\b(?:remote|home\s*-?\s*office|homeoffice)\b/i.test(text)
    && !/\bhybrid\b/i.test(text)
    && !clearsRemote(text)
  )
  next.alsoFullyRemote = both
  return next
}

function placesFrom(locations, text) {
  const states = statesIn(text)
  for (const place of locations) {
    const state = canonicalState(place)
    if (state && !states.includes(state)) states.push(state)
  }
  const cities = locations.filter((place) => !isState(place))
  return cities.length ? cities : states
}

function filtersFromMessage(filters, text) {
  const next = normalizeFilters(filters)
  const skip = negatedWords(text)
  const dropped = (term) => {
    const lower = term.toLowerCase()
    if (skip.has(lower)) return true
    for (const word of skip) {
      if (wordIn(term, word)) return true
    }
    return false
  }
  const keep = (list) => list.filter((term) => mentions(text, term) && !dropped(term))
  next.roles = next.roles.filter((role) => roleSpoken(text, role) && !dropped(role) && !isGenericRole(role))
  next.keywords = keep(next.keywords)
  next.locations = placesFrom(keep(next.locations).map(cleanPlace).filter((place) => place && !/^(deutschland|germany)$/i.test(place)), text)
  const sameRole = (term) => next.roles.some((role) => role.toLowerCase() === term.toLowerCase())
  next.skills = next.roles.length ? uniqueTerms(next.skills.filter((term) => !sameRole(term)), 16) : []
  next.aliases = next.roles.length
    ? uniqueTerms(next.aliases.filter((term) => !sameRole(term)), next.roles.length * 10)
    : []
  next.radiusKm = radiusFromText(text)
  if (!next.roles.length) {
    next.aliases = []
    next.intent = ""
    next.excludeTerms = keep(next.excludeTerms)
  }
  if (!/\bvor\s+ort\b|\bhome\s*-?\s*office\b|\bremote\b/i.test(text)) next.remote = "unspecified"
  if (!/\bteilzeit\b|\bvollzeit\b/i.test(text)) next.employment = null
  if (!/\bunbefristet\b|\bbefristet\b/i.test(text)) next.permanent = null
  if (!/\bzeitarbeit\b/i.test(text)) next.excludeTempAgency = false
  const money = salaryFromText(text)
  if (money.min == null && money.max == null) {
    next.salaryMin = null
    next.salaryMax = null
  }
  if (!isAnyLocation(text) && !/\b(?:deutschland|germany)\b/i.test(text)) next.locationAny = false
  if (clearsRemote(text)) {
    const dropRemote = (list) => list.filter((term) => !/^(remote|homeoffice)$/i.test(term))
    next.roles = dropRemote(next.roles)
    next.skills = dropRemote(next.skills)
    next.keywords = dropRemote(next.keywords)
  }
  next.query = jobQuery(next.roles, next.skills, text, next.query)
  return overlayPhrases(next, text)
}

function absorb(parts, term) {
  const clean = String(term || "").trim()
  if (!clean) return
  const lower = clean.toLowerCase()
  if (parts.some((item) => item.toLowerCase() === lower || item.toLowerCase().includes(lower))) return
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (lower.includes(parts[index].toLowerCase())) parts.splice(index, 1)
  }
  parts.push(clean)
}

function jobQuery(roles, skills, text, given) {
  const parts = []
  for (const role of roles) absorb(parts, role)
  for (const skill of skills) {
    if (mentions(text, skill)) absorb(parts, skill)
  }
  const built = parts.join(" ")
  const model = String(given || "").trim()
  if (model && parts.length && parts.every((part) => model.toLowerCase().includes(part.toLowerCase()))) return model
  return built
}

function uniqueTerms(list, limit) {
  const seen = new Set()
  const terms = []
  for (const term of list || []) {
    const key = String(term).toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= limit) break
  }
  return terms
}

function addsTo(text) {
  return /\b(?:zusätzlich|ausserdem|außerdem|dazu|ebenfalls)\b/i.test(text)
}

function dropsFrom(text) {
  return /\b(?:weg|ohne|nicht mehr|raus|entfernen|remove|drop)\b/i.test(text)
}

function mergePlaces(prior, spoken, text) {
  if (isAnyLocation(text)) return []
  if (!spoken.length) return [...prior]
  if (dropsFrom(text) && !addsTo(text)) {
    const drop = new Set(spoken.map((place) => place.toLowerCase()))
    return prior.filter((place) => !drop.has(place.toLowerCase()))
  }
  if (addsTo(text)) {
    const seen = new Set(prior.map((place) => place.toLowerCase()))
    const next = [...prior]
    for (const place of spoken) {
      if (!seen.has(place.toLowerCase())) next.push(place)
    }
    return next
  }
  return [...spoken]
}

function keepRoles(prior, spoken, text, link) {
  const kept = {
    ...prior,
    roles: [...prior.roles].filter((role) => !isGenericRole(role)),
    skills: spoken.skills.length ? spoken.skills : [...prior.skills],
    keywords: spoken.keywords.length ? spoken.keywords : [...prior.keywords],
    aliases: spoken.aliases.length ? spoken.aliases : [...(prior.aliases || [])],
    intent: spoken.intent || prior.intent,
    query: spoken.query || prior.query,
    locations: mergePlaces(prior.locations, spoken.locations, text),
    excludeTerms: [...prior.excludeTerms],
    alsoFullyRemote: spoken.alsoFullyRemote || prior.alsoFullyRemote,
    maxAgeHours: link?.maxAgeHours ?? spoken.maxAgeHours ?? prior.maxAgeHours
  }
  const radius = radiusFromText(text)
  if (radius != null) kept.radiusKm = radius
  return overlayPhrases(kept, text)
}

function applySalary(filters, text) {
  const next = { ...filters }
  const lower = text.toLowerCase()
  if (/\bgehalt\b/.test(lower) && /\begal\b/.test(lower)) {
    next.salaryMin = null
    next.salaryMax = null
    return next
  }
  const money = salaryFromText(text)
  if (money.min != null) next.salaryMin = money.min
  if (money.max != null) next.salaryMax = money.max
  return next
}

function canSearch(filters) {
  return hasAnchor(filters) || hasConstraint(filters)
}

function gateSearch(previousRaw, interpreted, text, link) {
  const previous = previousRaw ? normalizeFilters(previousRaw) : null
  const prior = previous && canSearch(previous) ? previous : null
  const spoken = filtersFromMessage(interpreted.filters, text)
  if (link?.maxAgeHours && ageFromText(text) == null) spoken.maxAgeHours = link.maxAgeHours
  if (!interpreted.ready) {
    return { filters: prior || normalizeFilters(null), search: false }
  }
  const connected = link?.related === true && (interpreted.continues === true || isRefinement(text) || addsTo(text) || dropsFrom(text))
  let filters = spoken
  if (prior && connected) filters = keepRoles(prior, spoken, text, link)
  filters = applySalary(filters, text)
  if (!canSearch(filters)) return { filters: prior || filters, search: false }
  return { filters, search: true }
}

module.exports = {
  SYSTEM,
  FILTERS,
  normalizeFilters,
  hasAnchor,
  hasConstraint,
  isNewRole,
  mergeFilters,
  gateSearch
}
