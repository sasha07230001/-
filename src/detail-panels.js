const text = (value, limit) => String(value ?? '').trim().slice(0, limit);

export const DETAIL_MAX = 3;

export const REALISM_POSITIVE = 'photorealistic, raw photo, real human body, natural skin texture, visible pores, realistic lighting, shallow depth of field, film grain';
export const REALISM_NEGATIVE = 'anime, 2d, cartoon, manga, cel shading, flat color, lineart, sketch, painting, 3d render, cgi, doll, plastic skin, stylized, illustration';
export const DETAIL_NEGATIVE = 'panel overlapping the character, cropped panel, illegible detail, blurred detail, unreadable anatomy';

const PLACEMENTS = ['lower right', 'lower left', 'upper right', 'upper left'];

// One panel is an extreme close-up, the second is a cutaway so the insertion stays
// readable even when the main camera only sees the front of the person.
function panelText(detail, index) {
  const part = text(detail.part, 120) || 'the body part involved in the action';
  const action = text(detail.action, 300) || 'the described action';
  const camera = text(detail.camera, 200);
  const placement = PLACEMENTS.includes(detail.placement) ? detail.placement : PLACEMENTS[index] || 'lower right';
  if (index === 1) {
    return `second inset panel in the ${placement} background corner, anatomical cutaway view of ${part} showing ${action} inside the body, semi transparent cross-section, thin white frame`;
  }
  if (index > 1) {
    return `inset detail panel ${index + 1} in the ${placement} background corner, ${camera || 'top down view'} of ${part}, ${action}, thin white frame`;
  }
  return `inset detail panel in the ${placement} background corner, thin white frame, extreme close-up of ${part}, ${action}${camera ? `, ${camera}` : ''}`;
}

export function normalizeDetail(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const detail = {
    part: text(value.part, 120), action: text(value.action, 300),
    camera: text(value.camera, 200), placement: PLACEMENTS.includes(value.placement) ? value.placement : '',
  };
  return detail.part || detail.action ? detail : null;
}

export function normalizeDetails(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, DETAIL_MAX).map(normalizeDetail).filter(Boolean);
}

const join = (a, b) => [a, b].filter(Boolean).join(', ');

// Every requested panel is emitted even when the assistant describes fewer details than
// the configured count: the missing ones reuse the first detail (close-up, then its
// cutaway), so asking for two panels always yields a close-up plus a cross-section.
export function applyDetailPanels(positive, negative, details, { count = 0, realism = true, natural = false } = {}) {
  const given = count > 0 ? normalizeDetails(details).slice(0, count) : [];
  let nextPositive = String(positive || '').trim(), nextNegative = String(negative || '').trim();
  if (realism) {
    nextPositive = natural
      ? `${nextPositive}${nextPositive ? ' ' : ''}The whole frame is a photorealistic photograph of a real person, with natural skin texture and realistic light.`
      : join(nextPositive, REALISM_POSITIVE);
    nextNegative = join(nextNegative, natural
      ? 'anime, 2d, cartoon, manga, cel shading, illustration, 3d render, doll'
      : REALISM_NEGATIVE);
  }
  if (!count) return { positive: nextPositive, negative: nextNegative };
  const lines = Array.from({ length: count }, (unused, index) => panelText(given[Math.min(index, given.length - 1)] || {}, index));
  nextPositive = natural
    ? `${nextPositive}${nextPositive ? ' ' : ''}In the empty background corner, without covering the people, add ${lines.length > 1 ? 'inset panels: ' : 'an inset panel: '}${lines.join('; ')}.`
    : join(nextPositive, `${lines.join(', ')}, panels do not cover the characters`);
  return { positive: nextPositive, negative: join(nextNegative, DETAIL_NEGATIVE) };
}
