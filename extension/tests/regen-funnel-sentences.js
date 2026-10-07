// Regenerates fixtures-funnel-sentences.json: the sentence fnStopSentence produces
// for every branch (funnel-sentence-cases.js) and for every real recorded segment
// (fixtures-real-funnel.json).
//
//   cd extension/tests && jsc regen-funnel-sentences.js > fixtures-funnel-sentences.json
//
// READ THE DIFF BEFORE COMMITTING IT. The snapshot exists to catch a funnel
// sentence changing by accident, so regenerating it is only right after a
// DELIBERATE wording change, and then the diff should show exactly the sentences
// you meant to change and nothing else. The first version was generated from the
// build BEFORE fnStopSentence learned to describe step and prompt goals, which is
// what makes it a proof that funnel wording did not move.
load('funnel-sentence-cases.js');
var _bg = readFile('../background.js');
var FUNNEL = JSON.parse(readFile('fixtures-real-funnel.json'));
eval(_bg.slice(_bg.indexOf('function shouldRetryApiCall'), _bg.indexOf('async function anthropicFetch')));
eval(_bg.slice(_bg.indexOf('const FN_MAX_IMAGE_EDGE'), _bg.indexOf('// Returns { dataUrl, width, height')));
eval(_bg.slice(_bg.indexOf('const FN_STUCK_NUDGE'), _bg.indexOf('// Injected, so fully self-contained')));
var out = { cases: {}, real: {} };
Object.keys(FN_SENTENCE_CASES).sort().forEach(function (k) { out.cases[k] = fnStopSentence(FN_SENTENCE_CASES[k]); });
Object.keys(FUNNEL).sort().forEach(function (rid) {
  (FUNNEL[rid].segments || []).forEach(function (sg, i) { out.real[rid + '#' + i] = fnStopSentence(sg); });
});
print(JSON.stringify(out, null, 1));
