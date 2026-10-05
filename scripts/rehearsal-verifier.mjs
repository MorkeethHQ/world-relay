// A VERIFIER DOUBLE FOR REHEARSAL. Not a model. It calls nothing.
//
// It accepts every proof it is shown. Its only purpose is to let the re-check job
// be rehearsed end to end against the local fake store (scripts/fake-store.mjs):
// with it, an --apply run gets past the model key check to the confirm code gate,
// and with a real code it goes on to write to the fake, so those writes can be
// counted.
//
// scripts/recheck-thrown-proofs.mjs loads this only when RECHECK_VERIFIER_MODULE
// names it, and refuses to load any double unless the store is on this machine.
export default async function rehearsalVerifier() {
  return { verdict: "pass", reasoning: "REHEARSAL DOUBLE: accepted without looking. No model was called.", confidence: 0.9 };
}
