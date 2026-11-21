import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST_GUARD_NEGATIVE, applyCastPrompt, castCountTag, castGender, castOf, splitTags } from './cast-guard.js';
import { normalizeProfile, normalizeProfileLibrary, normalizeHistory, recordProfileChanges, PROFILE_HISTORY_LIMIT } from './character-profiles.js';
import { checkAssistantPlan } from './assistant-lint.js';
import { applyAssistantPlan } from './prompt-assistant.js';

const girl = normalizeProfile({ id: 'girl', name: '小蓝', tags: '1girl, long black hair, golden eyes', body: 'slender',
  lockAppearance: false });
const boy = normalizeProfile({ id: 'boy', name: '小红', tags: '1boy, short silver hair, blue eyes', body: 'athletic build',
  lockAppearance: false });
const entries = () => [{ profileId: 'girl', profile: girl, participation: 'auto' }, { profileId: 'boy', profile: boy, participation: 'auto' }];
const scene = () => ({ entries: entries() });
const plan = (patch = {}) => ({ positive: '1girl, 1boy, indoors, rainy window', negative: 'blurry',
  characterIds: ['girl', 'boy'], characters: [], characterScene: scene(), ...patch });

test('cast gender and head counts come from the profile tags', () => {
  assert.equal(castGender(girl), 'girl'); assert.equal(castGender(boy), 'boy');
  assert.equal(castGender(normalizeProfile({ id: 'x', tags: 'cat, sitting' })), '');
  assert.equal(castCountTag(['girl']), 'solo');
  assert.equal(castCountTag(['girl', 'girl']), '2girls');
  assert.equal(castCountTag(['boy', 'boy', 'boy']), '3boys');
  assert.equal(castCountTag(['girl', 'boy']), '1girl, 1boy');
  assert.equal(castCountTag(['girl', 'boy', 'boy']), '1girl, 2boys');
  assert.deepEqual(splitTags(' a, b\nc ,, '), ['a', 'b', 'c']);
  assert.deepEqual(castOf(scene(), ['girl']).map((row) => row.name), ['小蓝']);
});

test('bound profiles are named instead of generic person tags, with the head count and anti-crowd negatives added', () => {
  const guard = applyCastPrompt(plan().positive, plan().negative, castOf(scene(), plan().characterIds));
  const tags = guard.positive.split(', ');
  assert.deepEqual(tags.slice(0, 2), ['小蓝', '小红']);
  assert.deepEqual(tags.slice(2, 4), ['1girl', '1boy']); // the head count only
  assert.equal(tags.filter((tag) => tag === '1girl').length, 1);
  assert.equal(guard.positive.includes('indoors'), true);
  for (const word of CAST_GUARD_NEGATIVE.split(', ')) assert.equal(guard.negative.includes(word), true);
  assert.equal(guard.negative.startsWith('blurry'), true);
});

test('each guard switch only disables its own behaviour', () => {
  const cast = castOf(scene(), ['girl', 'boy']);
  const unnamed = applyCastPrompt(plan().positive, plan().negative, cast, { castNaming: false });
  assert.equal(unnamed.positive.startsWith('1girl, 1boy'), true);
  assert.equal(unnamed.negative.includes('extra person'), true);
  const uncounted = applyCastPrompt(plan().positive, plan().negative, cast, { castCount: false });
  assert.equal(uncounted.negative, 'blurry');
  assert.equal(uncounted.positive.startsWith('小蓝, 小红'), true);
  assert.equal(uncounted.positive.includes('1girl, 1boy'), false);
});

test('an empty cast is left untouched while prose only receives the anti-crowd negative', () => {
  assert.deepEqual(applyCastPrompt('1girl, indoors', 'blurry', []), { positive: '1girl, indoors', negative: 'blurry' });
  const prose = 'The two of them sit by the rainy window, her hands folded on the book.';
  const guarded = applyCastPrompt(prose, 'blurry', castOf(scene(), ['girl', 'boy']));
  assert.equal(guarded.positive, prose);
  assert.equal(guarded.negative.startsWith('blurry, extra person'), true);
  assert.equal(applyCastPrompt(prose, 'blurry', castOf(scene(), ['girl', 'boy']), { castCount: false }).negative, 'blurry');
});

test('the assistant plan rewrite names the cast and keeps the configured negative', () => {
  const snapshot = { provider: 'novelai', params: { model: 'nai-diffusion-4-5-full', positive: '', negative: '', width: 832, height: 1216 } };
  const result = { positive: '1girl, 1boy, indoors, rainy window', negative: 'blurry', reason: 'r',
    characterIds: ['girl', 'boy'], characterScene: scene() };
  const next = applyAssistantPlan(snapshot, result, { castNaming: true, castCount: true, detailPanels: 0, realismGuard: false });
  assert.equal(next.params.positive.startsWith('小蓝, 小红'), true);
  assert.equal(next.params.positive.includes('1girl'), true); // count tag only
  assert.equal(next.params.negative.includes('extra person'), true);
  const plain = applyAssistantPlan({ ...snapshot, params: { ...snapshot.params } }, result, { castNaming: false, castCount: false, detailPanels: 0, realismGuard: false });
  assert.equal(plain.params.positive.startsWith('1girl, 1boy'), true);
  assert.equal(plain.params.negative, 'blurry');
});

test('profile changes record the newest outfit and body state with history', () => {
  const library = normalizeProfileLibrary({ profiles: [girl, boy] });
  const next = recordProfileChanges(library, [
    { profileId: 'girl', outfit: 'white cotton ankle socks with red ribbon trim, navy sailor dress', body: '', evidence: '她换上了新袜子' },
    { profileId: 'ghost', outfit: 'ignored' },
  ], { at: 1000, evidence: 'fallback' });
  const saved = next.profiles.find((row) => row.id === 'girl');
  assert.equal(saved.outfitDetail, 'white cotton ankle socks with red ribbon trim, navy sailor dress');
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].kind, 'outfit');
  assert.equal(saved.history[0].at, 1000);
  assert.equal(saved.history[0].evidence, '她换上了新袜子');
  assert.equal(next.profiles.find((row) => row.id === 'boy').outfitDetail, '');
  assert.equal(recordProfileChanges(library, [{ profileId: 'girl', outfit: '', body: '' }]), library);
  const amputated = recordProfileChanges(next, [{ profileId: 'boy', body: 'left arm amputated below the elbow, bandaged stump' }], { at: 2000 });
  const injured = amputated.profiles.find((row) => row.id === 'boy');
  assert.equal(injured.bodyNote, 'left arm amputated below the elbow, bandaged stump');
  assert.equal(injured.history[0].kind, 'body');
});

test('history keeps only the newest entries within the limit', () => {
  const rows = Array.from({ length: PROFILE_HISTORY_LIMIT + 20 }, (_, index) => ({ id: `h${index}`, kind: 'outfit', at: index, text: `coat ${index}` }));
  const history = normalizeHistory([...rows, { id: 'bad', kind: 'weapon', text: 'x' }]);
  assert.equal(history.length, PROFILE_HISTORY_LIMIT);
  assert.equal(history[0].at, PROFILE_HISTORY_LIMIT + 19);
  assert.equal(history.some((row) => row.kind === 'weapon'), false);
});

test('lint reports generic person words, a missing head count and traits that belong to the other profile', () => {
  const codes = (value) => checkAssistantPlan(value).map((row) => row.code);
  const named = plan({ positive: '小蓝, 小红, 1girl, 1boy, indoors, rainy window, sitting, reading' });
  assert.equal(codes(named).includes('cast-naming'), false);
  const generic = plan({ positive: '1girl, 1boy, indoors, rainy window, sitting, reading' });
  assert.equal(codes(generic).includes('cast-naming'), true);
  const uncounted = plan({ positive: '小蓝, 小红, indoors, rainy window, sitting, reading' });
  assert.equal(codes(uncounted).includes('cast-count'), true);
  const bleed = plan({ positive: '小蓝, 小红, indoors, sitting, reading',
    characters: [{ profileId: 'girl', appearance: 'short silver hair, golden eyes', outfit: '', action: '', expression: '' },
      { profileId: 'boy', appearance: '', outfit: '', action: '', expression: '' }] });
  const issues = checkAssistantPlan(bleed);
  assert.equal(issues.some((row) => row.code === 'character-bleed' && row.message.includes('小红')), true);
  assert.deepEqual(codes(plan({ positive: '1girl, 1boy, indoors', characterScene: null })), []);
});
