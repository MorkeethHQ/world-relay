// AI-MADE DECOYS FOR REAL OR NOT, and nowhere else (2026-09-21).
//
// Oscar, relayed by ws2: "Can we generate a couple of other AI or fake things?"
// Real or Not is a game about spotting what is not real, and a deck of only real
// proofs gives a player nothing fake to find. These are that: a small set of text
// proofs WRITTEN BY AN AI (Claude, in this file), each answering its own invented
// favour ask, in the voice of real favours. Each one's correct call is always "Not".
//
// HOW THEY STAY CONTAINED:
//   - They are constants in this file, never tasks. The feed, History, /api/stats,
//     the mission proof strip, campaign results and every public count are built
//     from tasks, so a decoy cannot reach any of them. Only lib/jury.ts imports
//     this file, and a guard test fails if anything else does.
//   - No poster, no claimant, no wallet, no name, no handle, no photo. Nothing here
//     borrows a real person or a real proof.
//   - The game says up front that some cards are AI-made decoys, and reveals each
//     one as "AI-made decoy" after the call.
//
// This narrows, for this one game only, the repo rule against invented proofs, on
// Oscar's call. The words below are fixed in git so they can be reviewed exactly.
// Image decoys are deliberately absent: making them needs a paid image model.

export const DECOY_SOURCE = "FAVOUR decoy";
export const DECOY_ID_PREFIX = "decoy:";

export type Decoy = { id: string; description: string; proofNote: string; category: string; source: typeof DECOY_SOURCE };

export const DECOYS: Decoy[] = [
  { id: "decoy:street-sound", description: "What does your street sound like right now?", proofNote: "Mostly scooters, and a man selling bread from a bicycle who honks a little horn every few metres. The dogs answer him every time.", category: "custom", source: DECOY_SOURCE },
  { id: "decoy:window", description: "Describe the view from your window in one or two lines.", proofNote: "It is raining so the glass is fogged. I can just see the orange streetlight and half of the pharmacy sign across the road.", category: "custom", source: DECOY_SOURCE },
  { id: "decoy:missed-place", description: "Recommend one place near you that visitors always miss, and say why locals go.", proofNote: "The roof of the old market. Take the stairs behind the fish stalls, nobody stops you, and the sunset from up there is better than any viewpoint.", category: "review", source: DECOY_SOURCE },
  { id: "decoy:breakfast", description: "What did you have for breakfast today?", proofNote: "Leftover rice fried with an egg and some chili crisp my aunt sent from home. Five minutes, best thing I ate all week.", category: "custom", source: DECOY_SOURCE },
  { id: "decoy:queue", description: "Time the queue at the nearest cafe or bakery and report back.", proofNote: "About twelve minutes at 8:40. The card machine was down so everyone had to find cash, and the line went out the door.", category: "check-in", source: DECOY_SOURCE },
  { id: "decoy:copy-habit", description: "What is one thing people in your country do that the rest of the world should copy?", proofNote: "Neighbours' kids just walk in after school for homework and dinner. Nobody knocks, nobody minds, the whole street raises them.", category: "custom", source: DECOY_SOURCE },
  { id: "decoy:smell", description: "What does today smell like where you are?", proofNote: "Wet concrete and jasmine from the wall next door, and someone is grilling corn at the bus stop.", category: "custom", source: DECOY_SOURCE },
  { id: "decoy:honest-rating", description: "Rate one local place honestly, the real verdict.", proofNote: "The noodle place on the corner is a 7. The broth is great, but they forget orders when it is busy and the fan has been broken since spring.", category: "review", source: DECOY_SOURCE },
];

export function isDecoyId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(DECOY_ID_PREFIX);
}
