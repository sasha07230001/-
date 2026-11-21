import test from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_MAX, REALISM_NEGATIVE, REALISM_POSITIVE, applyDetailPanels, normalizeDetail, normalizeDetails } from './detail-panels.js';
import { buildAssistantMessages, parseAssistantResult, applyAssistantPlan, normalizeAssistant } from './prompt-assistant.js';

const details = [
  { part: 'anus', action: 'anal beads being pushed in', camera: 'extreme close-up from behind', placement: 'lower right' },
  { part: 'anus', action: 'beads inside the rectum', camera: '', placement: '' },
  { part: 'hand', action: 'gripping the beads', camera: 'top down view', placement: 'upper left' },
  { part: 'ignored', action: 'over the limit' },
];

test('detail panels normalise input and refuse empty rows', () => {
  assert.equal(normalizeDetails(details).length, DETAIL_MAX);
  assert.equal(normalizeDetail({ part: '', action: '' }), null);
  assert.equal(normalizeDetail({ part: 'ankle', action: 'sock pulled on', placement: 'middle' }).placement, '');
  assert.deepEqual(normalizeDetails('nope'), []);
});

test('an inset close-up is followed by a cutaway of the same body part', () => {
  const result = applyDetailPanels('1girl, bedroom', 'blurry', details, { count: 2, realism: true });
  assert.match(result.positive, /inset detail panel in the lower right background corner/);
  assert.match(result.positive, /extreme close-up of anus, anal beads being pushed in/);
  assert.match(result.positive, /anatomical cutaway view of anus showing beads inside the rectum/);
  assert.match(result.positive, /photorealistic/);
  assert.match(result.negative, /anime/);
  assert.match(result.negative, /panel overlapping the character/);
});

test('one described detail still fills every configured panel with a cutaway', () => {
  const single = applyDetailPanels('1girl, bedroom', '', [details[0]], { count: 2, realism: false });
  assert.match(single.positive, /extreme close-up of anus, anal beads being pushed in/);
  assert.match(single.positive, /second inset panel in the lower right background corner, anatomical cutaway view of anus showing anal beads being pushed in/);
  const none = applyDetailPanels('1girl', '', [], { count: 2, realism: false });
  assert.match(none.positive, /inset detail panel in the lower right background corner/);
  assert.match(none.positive, /second inset panel in the lower left background corner, anatomical cutaway view/);
  const three = applyDetailPanels('1girl', '', [details[0]], { count: 3, realism: false });
  assert.equal(three.positive.match(/inset panel|inset detail panel/g).length, 3);
});

test('zero panels keeps the frame photoreal without adding panels', () => {
  const result = applyDetailPanels('1girl', '', details, { count: 0, realism: true });
  assert.equal(result.positive.includes('inset detail panel'), false);
  assert.equal(result.positive, `1girl, ${REALISM_POSITIVE}`);
});

test('the realism guard can be switched off and falls back to a neutral panel', () => {
  const plain = applyDetailPanels('1girl', '', details, { count: 1, realism: false });
  assert.equal(plain.positive.includes('photorealistic'), false);
  assert.equal(plain.negative.includes(REALISM_NEGATIVE), false);
  const fallback = applyDetailPanels('1girl', '', [], { count: 1, realism: false });
  assert.match(fallback.positive, /inset detail panel in the lower right background corner/);
});

test('natural prompts receive the panel request as prose', () => {
  const result = applyDetailPanels('A woman stands in a dim room.', '', details, { count: 2, realism: true, natural: true });
  assert.match(result.positive, /In the empty background corner, without covering the people, add inset panels:/);
  assert.equal(result.positive.includes(REALISM_POSITIVE), false);
});

test('settings default to two panels with the realism guard on', () => {
  const options = normalizeAssistant({});
  assert.equal(DETAIL_MAX, 3);
  assert.equal(options.detailPanels, 2);
  assert.equal(options.realismGuard, true);
  assert.equal(normalizeAssistant({ detailPanels: 9 }).detailPanels, 3);
  assert.equal(normalizeAssistant({ detailPanels: -4 }).detailPanels, 0);
  assert.equal(normalizeAssistant({ realismGuard: false }).realismGuard, false);
});

test('the assistant rules ask for hidden-part details and forbid 2d', () => {
  const messages = buildAssistantMessages({ settings: {}, operation: 'generate', input: 'test', target: { provider: 'novelai' } });
  const system = messages[0].content;
  assert.match(system, /return details: \[\{"part":"English body part"/);
  assert.match(system, /at most 2 entries/);
  assert.match(system, /photorealistic photograph of a real person/);
  assert.match(system, /from behind, rear view/);
  const off = buildAssistantMessages({ settings: { detailPanels: 0, realismGuard: false }, operation: 'generate', input: 'test', target: { provider: 'novelai' } });
  assert.equal(off[0].content.includes('return details:'), false);
  assert.equal(off[0].content.includes('Never anime'), false);
});

test('parsing keeps details and applying them builds the panel prompt', () => {
  const raw = JSON.stringify({ shouldDraw: true, reason: 'r', positive: '1girl, bedroom, holding toy', negative: '',
    details: details.slice(0, 2) });
  const plan = parseAssistantResult(raw);
  assert.equal(plan.details.length, 2);
  assert.equal(plan.characters, undefined);
  const snapshot = { provider: 'novelai', params: { model: 'nai-diffusion-3', positive: '', negative: 'lowres' } };
  const applied = applyAssistantPlan(snapshot, plan, {});
  assert.match(applied.params.positive, /1girl, bedroom, holding toy/);
  assert.match(applied.params.positive, /inset detail panel/);
  assert.match(applied.params.negative, /anime/);
  assert.match(applied.params.negative, /lowres/);
});
