// WHAT A FAVOUR MAY NOT ASK A PERSON FOR (2026-10-05, cold walk item 1).
//
// A favour is read by a stranger who sees one thing: the posted description. A
// cold walk of the draft pack found three drafts that could expose the person
// answering (a photo of the street outside their home plus their town, a speed
// test screenshot plus their network name, an ATM screen), and found that the
// review test stayed green on a row asking for a passport photo, a phone number
// and a home address.
//
// This module is the missing check. It is used by the draft pack's review test.
// It is NOT wired into POST /api/tasks or the refill engine: that is a product
// decision (it would refuse real posts), and it has not been made.
//
// It is a list of phrases, so it is narrow on purpose and it will miss things. A
// green result means "none of the known asks", never "safe". A person still
// reads every draft.

export type PersonalDataKind =
  | "identity document"
  | "contact detail"
  | "home or precise location"
  | "face of another person"
  | "financial screen"
  | "account or network identifier";

const RULES: Array<[PersonalDataKind, RegExp]> = [
  [
    "identity document",
    /\b(passports?|id cards?|identity (cards?|documents?|papers)|national id|driv(?:er'?s?|ing) licen[cs]es?|residence permits?|birth certificates?|social security|student cards?|proof of (identity|address)|your id\b|photo id)\b/i,
  ],
  [
    "financial screen",
    /\b(atm\b|cash machines?|bank(?:ing)? (app|statement|account|balance|card|details)|card numbers?|credit cards?|debit cards?|account balance|pay ?slips?|salary|transaction history|seed phrase|private key|wallet (balance|address))/i,
  ],
  [
    "account or network identifier",
    /\b(user ?names?|account (name|number|id)|log ?in details|passwords?|wi-?fi|ssid|network name|name (of )?your network|your network|ip address|imei|serial number|mac address|speed ?test|sim card|screenshot (of )?your (phone|settings|home screen|profile))\b/i,
  ],
  [
    "contact detail",
    /\b(phone numbers?|mobile numbers?|your number|whatsapp|telegram|e-?mail( address(es)?)?|contact details|full name|real name|date of birth|your birthday)\b/i,
  ],
  [
    "home or precise location",
    /\b(home address|your address|house number|your street|street outside|outside your (home|house|flat|apartment|window|door|building)|from your (window|balcony|home|house|flat|apartment|bedroom)|your (front door|home|house|flat|apartment|bedroom|living room)|post ?code|zip code|gps|coordinates|exact location|live location|pin on (a|the) map)\b/i,
  ],
  [
    "face of another person",
    /\b(selfies?|face visible|faces?|portraits?|photo(?:graph)? (of )?(a |an |the |some |your )?(person|people|stranger|strangers|child|children|kids?|neighbou?rs?|staff|cashier|driver|customers?|crowd|passers?-?by|family|friends?)|someone'?s)\b/i,
  ],
];

// Returns the first kind of personal data the posted text asks for, or null.
// `safety` is the row's declared safety clause. It is cut out of the text before
// the scan, because a clause such as "No people, no phone numbers in the photo"
// names the very things it forbids. Only the exact declared clause is excused.
export function personalDataAsk(description: string, safety?: string): { kind: PersonalDataKind; match: string } | null {
  let text = description;
  if (safety && safety.trim() && text.includes(safety)) text = text.replace(safety, " ");
  for (const [kind, re] of RULES) {
    const m = re.exec(text);
    if (m) return { kind, match: m[0] };
  }
  return null;
}

// A safety clause must LIMIT what the person sends. It may not be a second ask in
// disguise. Returns a reason when the clause is not acceptable, else null.
const LIMITING = /^(no |do not |don't |never |nothing |words only|wait until no |keep |leave |[a-z ]{2,30} only\b)/i;
const ASKING = /\b(send|share|upload|include|attach|add|give|tell us|post|show)\b/i;
const NEGATED_ASK = /\b(do not|don't|never|no need to) (send|share|upload|include|attach|add|give|post|show)\b/gi;

export function safetyClauseProblem(safety: string): string | null {
  const s = (safety ?? "").trim();
  if (s.length < 15) return "too short to be a safety clause";
  if (!LIMITING.test(s)) return "does not limit anything: a safety clause starts with No, Do not, Never, Nothing, Keep, Leave or \"... only\"";
  if (ASKING.test(s.replace(NEGATED_ASK, " "))) return "asks for something: a safety clause may only limit";
  return null;
}
