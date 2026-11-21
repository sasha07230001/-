// Cast guards keep a drawn scene honest about who is in it.
// Generic person tags (1girl, 1boy) carry no identity, so a bound profile is named
// instead, the visible head count is stated once, and extra people are pushed into
// negative. Everything here is deterministic and works on already generated output.

export const CAST_GUARD_NEGATIVE = 'extra person, extra people, third person, additional character, extra girls, extra boys, crowd, background characters, duplicate character, clone';

const PERSON_TAGS = new Set(['1girl', '1boy', '1girls', '1boys', 'solo', 'solo focus',
  'multiple girls', 'multiple boys', 'multiple people', 'multiple others',
  '2girls', '2boys', '3girls', '3boys', '4girls', '4boys', '5girls', '5boys', '6girls', '6boys',
  '2people', '3people', '4people', '5people', '6people', 'two people']);

export function splitTags(value) {
  return String(value || '').split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean);
}

export function castGender(profile) {
  const source = `${profile?.tags || ''} ${profile?.body || ''} ${profile?.features || ''}`.toLowerCase();
  if (/\b1girl\b|\bfemale\b|\bwoman\b|\bgirl\b/.test(source)) return 'girl';
  if (/\b1boy\b|\bmale\b|\bman\b|\bboy\b/.test(source)) return 'boy';
  return '';
}

export function castCountTag(genders) {
  const rows = genders.filter(Boolean);
  if (!rows.length) return '';
  const girls = rows.filter((row) => row === 'girl').length, boys = rows.filter((row) => row === 'boy').length;
  const total = rows.length;
  if (total === 1) return 'solo';
  if (girls === total) return `${total}girls`;
  if (boys === total) return `${total}boys`;
  return [girls ? `${girls}girl${girls > 1 ? 's' : ''}` : '', boys ? `${boys}boy${boys > 1 ? 's' : ''}` : '']
    .filter(Boolean).join(', ');
}

export function castOf(scene, characterIds) {
  const wanted = Array.isArray(characterIds) ? new Set(characterIds) : null;
  return (scene?.entries || [])
    .filter((entry) => !wanted || wanted.has(entry.profileId) || entry.participation === 'always')
    .map((entry) => ({ id: entry.profileId, name: entry.profile?.name || '', gender: castGender(entry.profile) }));
}

const looksLikeTags = (value) => {
  const rows = splitTags(value);
  return rows.length > 1 && !rows.some((row) => row.split(/\s+/).length > 8 || /[.。;；]/.test(row));
};

export function applyCastPrompt(positive, negative, cast, options = {}) {
  const naming = options.castNaming !== false, counting = options.castCount !== false;
  if (!Array.isArray(cast) || !cast.length) return { positive, negative };
  const guarded = counting ? [...new Set([String(negative || '').trim(), CAST_GUARD_NEGATIVE].filter(Boolean))].join(', ') : negative;
  if (!looksLikeTags(positive)) return { positive, negative: guarded };
  let tags = splitTags(positive);
  if (naming) tags = tags.filter((tag) => !PERSON_TAGS.has(tag.toLowerCase().replace(/\s+/g, ' ')));
  const names = naming ? cast.map((row) => String(row.name || '').trim()).filter(Boolean) : [];
  if (counting) tags = [...splitTags(castCountTag(cast.map((row) => row.gender))), ...tags];
  return { positive: [...new Set([...names, ...tags])].join(', '), negative: guarded };
}
