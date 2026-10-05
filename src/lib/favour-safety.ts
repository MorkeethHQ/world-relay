// A REVIEWER'S AID FOR DRAFT FAVOURS: does the posted text ask for personal data?
//
// READ THIS FIRST. This is a pattern matcher. It MISSES THINGS. Its measured reach
// on asks it was not written against is pinned in
// src/__tests__/favour-safety.test.ts, misses listed by name. A green result means
// "none of the patterns matched". It never means "safe". A person must read every
// favour before it is posted.
//
// It is used by the draft pack's review test and nowhere else. It is NOT wired
// into POST /api/tasks or the refill engine, on purpose: it would refuse honest
// posts (see the false alarms in the same test) and it would give a false sense
// of safety to whoever relied on it.
//
// HISTORY. Version 1 (5 Oct, 01:2x) was a list of exact phrases. A second cold
// walk wrote five plain unsafe asks (a home, a face, a bill, an account screen, a
// phone number) and it caught 0 of 5. It also cut the declared safety clause out
// of the text before scanning, so an ask placed inside that clause passed. On the
// frozen evaluation set it caught 0 of 20. This is version 2:
//   - the WHOLE posted text is scanned, safety clause included;
//   - a sensitive word is excused only when it is clearly FORBIDDEN in its own
//     clause ("no people", "do not send a screenshot"), and an exception after a
//     ban ("no people, only your passport") is not excused;
//   - each category is a set of word stems and patterns, wider than phrases.

export type PersonalDataKind =
  | "identity document"
  | "contact detail"
  | "home or precise location"
  | "face or other people"
  | "financial detail"
  | "account, device or network identifier"
  | "health detail"
  | "children";

// Words that address the person or what is theirs. Several rules need "yours" to
// be near the sensitive word: "a bank in your town" is a place, "your bank" is not.
const YOURS = "(?:your|yours|you|yourself|my|mine|own)";

const RULES: Array<[PersonalDataKind, RegExp]> = [
  [
    "identity document",
    new RegExp(
      [
        "\\bpassports?\\b",
        "\\b(?:id|identity|identification)\\s*(?:cards?|documents?|papers?|numbers?|badges?)\\b",
        "\\b(?:national|state|government|photo|student|voter|tax|residen\\w*|insurance|social security|health)\\s+(?:id|card|number|permit|certificate)s?\\b",
        `\\b${YOURS}\\s+id\\b`,
        "\\b(?:driv\\w*|fishing|hunting|work)\\s+(?:licen[cs]es?|permits?)\\b",
        "\\b(?:visa|birth certificates?|marriage certificates?|proof of (?:identity|address|residence|age))\\b",
        "\\b(?:maiden name|born in|place of birth|date of birth|birth ?date|birthday|how old are you|your age)\\b",
        "\\b(?:digits|numbers?|code)\\b[^.]{0,40}\\b(?:card|permit|licen[cs]e|certificate|document)\\b",
        "\\b(?:number|licen[cs]e)\\s*plates?\\b|\\bplate (?:on|of) (?:your|the|a) (?:car|van|bike|motorbike|vehicle)\\b|\\bregistration (?:number|plate)\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "contact detail",
    new RegExp(
      [
        "\\b(?:phone|mobile|cell|telephone|whatsapp|telegram|signal|viber|wechat|line)\\s*(?:numbers?|no\\.?|contact|id)\\b",
        `\\b${YOURS}\\s+(?:phone|mobile|cell|number|whatsapp|telegram|e-?mail|inbox|contacts?)\\b`,
        "\\b(?:mobile|cell|number|phone)\\b[^.]{0,30}\\b(?:reach|reached|call|called|ring|rung|text|texted|contact|contacted)\\b",
        "\\b(?:reach|call|ring|text|contact|message|dm|e-?mail)\\s+you\\b",
        "\\bhow (?:can|do|could) we (?:reach|contact|call|find) you\\b|\\bfind you (?:online|on)\\b",
        "\\be-?mail(?: address(?:es)?)?\\b",
        "\\b(?:contact details|full name|real name|legal name|surname|last name|family name|first and last name)\\b",
        "\\bname you (?:post|go|write|trade) (?:under|by)\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "home or precise location",
    new RegExp(
      [
        "\\b(?:home|house|street|postal|mailing|delivery|exact|full)\\s+address\\b|\\byour address\\b",
        "\\b(?:house|door|flat|apartment|building|unit|block)\\s+number\\b|\\bnumber (?:by|on|beside|next to|above) (?:the|your) door\\b",
        "\\b(?:building|house|flat|apartment|block|place|street|road|room|floor|door|area|neighbou?rhood)\\b[^.]{0,25}\\b(?:where|that|in which)? ?you (?:live|stay|sleep|rent|moved)\\b",
        "\\b(?:where|room|bed|place) you sleep\\b|\\broom you (?:sleep|live|work) in\\b",
        `\\b${YOURS}\\s+(?:home|house|flat|apartment|building|block|street|road|front door|door|doorbell|letter ?box|mail ?box|hallway|stairwell|garden|yard|driveway|garage|balcony|window|bedroom|living room|kitchen|bathroom|room|desk|neighbou?rhood|commute|workplace|office|school)\\b`,
        "\\b(?:from|out of|outside|inside|in front of|around)\\s+(?:your|my)\\s+\\w+",
        "\\bstreet outside\\b|\\bat home\\b|\\bview from home\\b",
        "\\b(?:post ?code|zip ?code|gps|coordinates|lat(?:itude)?|long(?:itude)?)\\b",
        "\\b(?:exact|precise|live|current|real[- ]time)\\s+(?:location|position|whereabouts)\\b|\\bshare your location\\b|\\bdrop (?:a|the) pin\\b|\\bpin (?:on|for|of) (?:a|the|your|where)\\b|\\bwhere you are (?:standing|sitting|right now exactly)\\b",
        "\\b(?:who|anyone|someone) (?:lives|is|stays) (?:with you|at home)\\b|\\b(?:place|home|house|flat) (?:is )?empty\\b|\\bwhen (?:are you|you are) (?:out|away|not home)\\b",
        "\\b(?:gate|door|entry|alarm|building) code\\b|\\bcode\\b[^.]{0,30}\\b(?:gate|door|building|entrance|alarm)\\b",
        "\\b(?:parcel|package|envelope|letter|delivery)\\b[^.]{0,40}\\b(?:for you|to you|you received|you got|your)\\b|\\blabel on (?:a|the|your) (?:parcel|package|envelope|letter)\\b",
        "\\bmeter (?:cupboard|box|reading)\\b",
        // Near the person AND a named spot: together they place someone within a short walk.
        "\\b(?:near(?:est)?|closest|close|next) (?:to )?you\\b[^]*\\bname the (?:street|road|stop|square|park|place|shop|station|corner|building)\\b",
        "\\b(?:within|inside) [^.]{0,25}(?:walk|minutes?|metres|meters|blocks?) (?:of|from) you\\b",
        "\\b(?:stop|station|shop|gym|cafe|bar|route|bus|line) you (?:use|take|go to|visit|ride)\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "face or other people",
    new RegExp(
      [
        "\\bselfies?\\b|\\bfaces?\\b|\\bportraits?\\b|\\bheadshots?\\b",
        "\\b(?:picture|photo|photograph|image|shot|video|clip|film|recording|snap)s?\\s+(?:of\\s+)?(?:yourself|you\\b|me\\b)",
        "\\byourself\\b",
        "\\b(?:beside|next to|under|by|against|near) your (?:chin|head|cheek|nose|eyes?|hair|smile|body|hand|arm)\\b|\\byour (?:chin|cheek|eyes|smile|body|tattoo|hair)\\b",
        "\\b(?:so we|to) (?:know|see|prove|check)[^.]{0,20}\\b(?:you are|you're) (?:real|human|you|there)\\b",
        "\\b(?:picture|photo|photograph|image|shot|video|clip|film|recording|snap)s?\\b[^.]{0,30}\\b(?:person|people|someone|somebody|anyone|stranger|strangers|man|woman|men|women|boy|girl|guy|lady|neighbou?rs?|staff|cashier|driver|waiter|customers?|crowd|passers?-?by|passengers?|family|friends?|colleagues?|partner|wife|husband|mother|father|parents?)\\b",
        "\\b(?:person|people|someone|stranger|man|woman|passenger|neighbou?r)\\b[^.]{0,25}\\b(?:sitting|standing|walking|waiting|closest|next to|beside|near)\\b",
        "\\b(?:who (?:it was|sent|wrote|called|is in)|say who)\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "financial detail",
    new RegExp(
      [
        "\\batms?\\b|\\bcash (?:machine|point)s?\\b",
        `\\b${YOURS}\\s+(?:bank|card|cards|account|accounts|balance|wallet|salary|wage|wages|income|pay|payslip|savings|debts?|loan|mortgage|rent|bill|bills|invoice|receipt|receipts|statement|taxes|tax|pension|holdings|portfolio)\\b`,
        "\\b(?:bank|card|credit|debit|account|wallet|billing)\\s+(?:statements?|details|numbers?|balance|app|login|pin)\\b",
        "\\b(?:electricity|gas|water|phone|internet|utility|energy|rent|tax|medical|hospital)\\s+(?:bills?|invoices?|statements?)\\b|\\b(?:latest|last|recent|monthly)\\s+(?:bill|invoice|statement|payslip)\\b",
        "\\bbalance\\s+(?:screen|page|of)\\b|\\b(?:screen|page)\\b[^.]{0,20}\\bbalance\\b",
        "\\bhow (?:much|many)\\b[^.?]{0,40}\\b(?:you (?:earn|make|hold|own|have saved|owe|pay|spend)|do you (?:earn|make|hold|own|owe|pay))\\b",
        "\\bwhat you (?:earn|make|owe|pay|spend)\\b|\\b(?:goes|spend|spent) on rent\\b",
        "\\b(?:seed phrase|recovery phrase|private key|secret key|cvv|cvc|iban|sort code|routing number|pin code)\\b",
        "\\b(?:digits|numbers?)\\b[^.]{0,30}\\b(?:card|account)\\b|\\bcard you (?:tap|pay|use)\\b",
        "\\bpay ?slips?\\b|\\btransaction (?:history|list)\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "account, device or network identifier",
    new RegExp(
      [
        "\\bscreen ?shots?\\b|\\bscreen ?(?:recording|grab|capture)s?\\b",
        "\\b(?:lock|home|settings|balance|profile|login|account)\\s+screen\\b|\\bscreen of your\\b",
        "\\buser ?names?\\b|\\bhandles?\\b|\\blog ?in\\b|\\bpass ?words?\\b|\\bpass ?codes?\\b",
        "\\baccount (?:name|number|id|page)\\b|\\bprofile (?:page|link|url)\\b",
        "\\bwi-?fi\\b|\\bssid\\b|\\bip address\\b|\\bmac address\\b|\\bimei\\b|\\bserial number\\b|\\bsim (?:card|number)\\b|\\bspeed ?test\\b",
        "\\b(?:network|router|hotspot|carrier|provider|operator)\\s+(?:name|id)\\b|\\bname (?:of )?your (?:network|router|provider|carrier|operator|supplier)\\b|\\byour (?:network|router|provider|carrier|supplier)\\b|\\bname the (?:supplier|provider|carrier|operator)\\b",
        `\\b${YOURS}\\s+(?:phone|device|laptop|computer|tablet|watch|messages?|chats?|inbox|notifications?|gallery|camera roll|browser|history|apps|settings|profile|world app|world id|car|vehicle)\\b`,
        "\\b(?:last|latest|recent) (?:message|text|chat|e-?mail|call|notification)\\b|\\bmessage (?:someone|somebody|they|he|she) sent you\\b",
        "\\bworld (?:app|id)\\b[^.]{0,30}\\b(?:screen|balance|address|code|qr)\\b|\\bqr code\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "health detail",
    new RegExp(
      [
        "\\b(?:medical|medication|medicine|medicines|prescription|prescriptions|pills?|tablets?|dosage|diagnos\\w*|illness\\w*|disease\\w*|symptoms?|therapy|therapist|surgery|allerg\\w*|disabilit\\w*|pregnan\\w*|vaccin\\w*|blood (?:pressure|sugar|type|test)|mental health|test results?)\\b",
        `\\b${YOURS}\\s+(?:health|doctor|dentist|weight|condition|treatment|hospital|clinic|body)\\b`,
        "\\b(?:doctor|dentist|hospital|clinic|nurse|pharmacist)\\b[^.]{0,30}\\b(?:gave you|told you|prescribed|your (?:last )?(?:visit|appointment))\\b",
        "\\bwhat do you take\\b|\\bhow much do you weigh\\b",
      ].join("|"),
      "i",
    ),
  ],
  [
    "children",
    new RegExp(
      [
        `\\b${YOURS}\\s+(?:child|children|kid|kids|son|sons|daughter|daughters|baby|babies|toddler|toddlers|little ones?|grandchild\\w*|nephew|niece|pupils?|students?)\\b`,
        "\\b(?:picture|photo|photograph|image|shot|video|clip|film|recording|snap)s?\\b[^.]{0,30}\\b(?:child|children|kids?|bab(?:y|ies)|toddlers?|boys?|girls?|pupils?|minors?|teenagers?)\\b",
        "\\b(?:school|nursery|kindergarten|daycare|playground|class)\\b[^.]{0,40}\\b(?:your|they|do they|go to|finish|pick(?:ed)? up)\\b",
        "\\b(?:toddlers?|bab(?:y|ies)|minors?|little ones?)\\b",
      ].join("|"),
      "i",
    ),
  ],
];

// A sensitive word is excused only when its own clause clearly FORBIDS it.
//
// The text is cut into clauses at sentence ends, commas, colons and at the words
// that turn a ban into an exception (only, but, except, unless, instead, just,
// rather). Inside one clause, a match is excused when a negator stands before it
// and nothing in between asks for something. "Do not send a screenshot" is a ban:
// the negator governs the verb. "No kidding, send your passport" is not: the
// negator belongs to another clause. "No kidding send your passport", without the
// comma, is caught by the ask verb between the negator and the match.
const CLAUSE_BREAK = /[.;:!?,\n]|\b(?:only|but|except|unless|instead|just|rather|however|though|yet)\b/gi;
const NEGATOR = /\b(?:no|not|never|without|nothing|neither|nor|don't|dont|do not|does not|doesn't|must not|mustn't|cannot|can't|avoid|leave out|keep out|hide|blur|cover|crop out|wait until no)\b/gi;
const ASK_VERB = /\b(?:send|share|upload|include|attach|add|give|tell|post|show|photo|photograph|snap|film|record|screenshot|name|write|read|say|type|enter|hold|take|drop|list)\b/i;
const GOVERNED = /^\s*(?:(?:any|a|an|the|your|of|to|need|needed|needs)\s+){0,3}$/i;

function clauses(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let last = 0;
  CLAUSE_BREAK.lastIndex = 0;
  for (let m = CLAUSE_BREAK.exec(text); m; m = CLAUSE_BREAK.exec(text)) {
    out.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  out.push({ start: last, end: text.length });
  return out;
}

function isForbidden(text: string, at: number): boolean {
  const c = clauses(text).find((x) => at > x.start && at <= x.end);
  if (!c) return false;
  const before = text.slice(c.start, at);
  let neg: RegExpExecArray | null = null;
  NEGATOR.lastIndex = 0;
  for (let m = NEGATOR.exec(before); m; m = NEGATOR.exec(before)) neg = m;
  if (!neg) return false;
  const between = before.slice(neg.index + neg[0].length);
  const verb = ASK_VERB.exec(between);
  if (!verb) return true;
  // A verb between the negator and the match is fine only when the negator
  // governs that verb directly: "do not send a ...", "never share your ...".
  return GOVERNED.test(between.slice(0, verb.index));
}

// Returns the first kind of personal data the posted text asks for, or null.
// The whole text is read. There is no way to mark part of it as exempt.
export function personalDataAsk(description: string): { kind: PersonalDataKind; match: string } | null {
  const text = description ?? "";
  for (const [kind, re] of RULES) {
    const g = new RegExp(re.source, "gi");
    for (let m = g.exec(text); m; m = g.exec(text)) {
      if (m[0].length === 0) { g.lastIndex++; continue; }
      // Judged at the END of the match: a pattern such as "photo ... people" starts
      // at the verb, and the ban ("without any people") sits just before its last word.
      if (!isForbidden(text, m.index + m[0].length)) return { kind, match: m[0] };
    }
  }
  return null;
}

// A safety clause must LIMIT what the person sends, and may not ask for anything.
// Returns a reason when the clause is not acceptable, else null.
export function safetyClauseProblem(safety: string): string | null {
  const s = (safety ?? "").trim();
  if (s.length < 15) return "too short to be a safety clause";
  NEGATOR.lastIndex = 0;
  const limits = NEGATOR.test(s) || /\bonly\b/i.test(s);
  if (!limits) return "does not limit anything: a safety clause forbids something (no, do not, never, without) or narrows it (\"... only\")";
  const hit = personalDataAsk(s);
  if (hit) return `asks for something: ${hit.kind} ("${hit.match}")`;
  // A clause that is all ask and no ban, with no sensitive word, is still an ask.
  const parts = clauses(s).map((c) => s.slice(c.start, c.end)).filter((p) => p.trim().length > 2);
  const asking = parts.filter((p) => { NEGATOR.lastIndex = 0; return ASK_VERB.test(p) && !NEGATOR.test(p); });
  if (asking.length > 0 && asking.length === parts.length) return "asks for something and forbids nothing";
  return null;
}
