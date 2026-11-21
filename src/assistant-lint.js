import { parsePrompt, promptIdentity, serializePrompt } from './prompt-composer.js';
import { illustrationPlans, syncPrimaryIllustration } from './assistant-workflow.js';
import { splitTags } from './cast-guard.js';

const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const safeTag = (item) => item.kind === 'tag' && item.syntax === 'plain' && /^[a-z0-9_ ()\\.'+-]{1,70}$/i.test(item.raw)
  && item.raw.split(/\s+/).length <= 6 && !/[.!?]$/.test(item.raw);
const simpleTags = (value) => parsePrompt(value).items.filter(safeTag).map((item) => promptIdentity(item.en));

export function lintPromptField(value) {
  const parsed = parsePrompt(value), seen = new Set(), duplicates = [];
  const items = parsed.items.filter((item) => {
    if (!safeTag(item)) return true;
    const key = promptIdentity(item.en);
    if (seen.has(key)) { duplicates.push(item.raw); return false; }
    seen.add(key); return true;
  });
  return { duplicates, corrected: duplicates.length ? serializePrompt(items) : String(value || ''),
    syntax: parsed.warnings.filter((row) => !row.includes('重复')) };
}

function conflicts(value) {
  const tags = simpleTags(value);
  const result = [];
  for (const [label, suffix, colors] of [
    ['发色', 'hair', ['black', 'white', 'silver', 'blonde', 'brown', 'red', 'blue', 'green', 'pink', 'purple']],
    ['瞳色', 'eyes', ['black', 'brown', 'red', 'blue', 'green', 'pink', 'purple', 'yellow']],
  ]) {
    if (tags.some((tag) => /multicolored|two tone|gradient|heterochromia|rainbow|streaked/.test(tag))) continue;
    const values = colors.filter((color) => tags.includes(`${color} ${suffix}`));
    if (values.length > 1) result.push(`${label}同时包含 ${values.join(' / ')}，请核对角色设定`);
  }
  return result;
}

const PERSON_WORD = /^(?:1girl|1boy|solo|solo focus|multiple girls|multiple boys|multiple people|multiple others|two people|[2-9]\d*(?:girls|boys|people)|female|male|woman|man|girl|boy|child|person)$/;
const phraseSignature = (profile) => [...new Set(splitTags([profile?.hair, profile?.eyes, profile?.body, profile?.features, profile?.tags]
  .filter(Boolean).join(', ')).map((row) => compact(row).toLowerCase()))]
  .filter((row) => /[a-z]/.test(row) && !PERSON_WORD.test(row) && (row.split(/\s+/).length >= 2 || row.length >= 8));
const COUNT_TAG = /^(?:[2-9]\d*|multiple) ?(?:girls|boys|people|characters)$/;

// Every character entry must describe one person only, so traits that belong to a
// different profile are a real defect, not a style choice.
function bleed(rows, entries) {
  const result = [], signatures = new Map(entries.map((entry) => [entry.profileId, phraseSignature(entry.profile)]));
  for (const row of rows) {
    const text = compact(`${row.appearance || ''} ${row.outfit || ''} ${row.positive || ''}`).toLowerCase();
    if (!text) continue;
    const own = entries.find((item) => item.profileId === row.profileId);
    const mine = signatures.get(row.profileId) || [];
    for (const entry of entries) {
      if (entry.profileId === row.profileId) continue;
      for (const phrase of signatures.get(entry.profileId) || []) {
        if (mine.includes(phrase) || !text.includes(phrase)) continue;
        result.push(`「${own?.profile?.name || row.profileId}」的条目里出现「${entry.profile?.name || entry.profileId}」的特征：${phrase}`);
      }
    }
  }
  return [...new Set(result)];
}

export function checkAssistantPlan(plan, { target = null, shotIndex = 0, tagCount = 0 } = {}) {
  const shots = illustrationPlans(plan), shot = shots[shotIndex];
  if (!shot) return [];
  const issues = [], add = (code, message, fix, field) => issues.push({ id: `${code}-${issues.length}`, code, message, ...(fix ? { fix, field } : {}) });
  for (const [field, name] of [['positive', '正向提示词'], ['negative', '负面提示词']]) {
    const result = lintPromptField(shot[field]);
    if (result.duplicates.length) add('duplicate', `${name}有 ${result.duplicates.length} 个重复标签：${result.duplicates.slice(0, 6).join('、')}`, 'deduplicate', field);
    for (const warning of result.syntax) add('syntax', `${name}：${warning}`);
  }
  const positive = new Set(simpleTags(shot.positive)), overlap = simpleTags(shot.negative).filter((tag) => positive.has(tag));
  if (overlap.length) add('positive-negative', `正负向同时出现 ${[...new Set(overlap)].slice(0, 6).join('、')}，请确认是否有意这样设置`);
  const entries = plan.characterScene?.entries || [];
  const directions = shot.characters || [];
  for (const entry of entries) {
    if (!directions.some((row) => row.profileId === entry.profileId)) {
      add('missing-character', `${entry.profile?.name || entry.profileId} 缺少画面角色条目`, 'restore-character', entry.profileId);
    }
  }
  const tags = simpleTags(shot.positive);
  const multiple = tags.some((tag) => /^(?:[2-9]\d*|multiple) ?(?:girls|boys|people|characters)$/.test(tag))
    || tags.includes('1girl') && tags.includes('1boy');
  if (!multiple && entries.length <= 1 && directions.length <= 1) for (const message of conflicts(shot.positive)) add('conflict', message);
  for (const row of directions) {
    const entry = entries.find((item) => item.profileId === row.profileId);
    const appearance = entry?.profile?.lockAppearance ? '' : row.appearance;
    for (const message of conflicts(appearance)) add('conflict', `${entry?.profile?.name || row.profileId}：${message}`);
  }
  if (shot.anchor) {
    if (target === null) add('anchor-unverified', '原文定位句尚未核对，请读取当前原文后检查');
    else {
      const source = compact(target), anchor = compact(shot.anchor), index = source.indexOf(anchor);
      const duplicate = shots.some((row, other) => other !== shotIndex && compact(row.anchor) === anchor);
      if (anchor.length < 2 || index < 0 || source.indexOf(anchor, index + 1) >= 0 || duplicate) {
        add('anchor', '原文定位句不存在、不唯一或被其他画面重复使用，可清除后改在消息末尾显示', 'clear-anchor', 'anchor');
      }
    }
  }
  if (tagCount > 0) {
    const rows = String(shot.positive || '').split(',').map((row) => row.trim()).filter(Boolean);
    const unique = new Set(rows.map((row) => row.toLowerCase()));
    if (unique.size < tagCount) {
      add('tag-density', `正向提示词只有 ${unique.size} 个标签，低于设定的 ${tagCount} 个。可在面板里降低标签数量，或让助手补充分镜、动作、手部、服饰、道具、环境与光影标签`);
    }
  }
  if (entries.length) {
    const names = entries.map((entry) => compact(entry.profile?.name || entry.profileId));
    const pair = entries.length >= 2 && tags.includes('1girl') && tags.includes('1boy');
    const lowered = compact(shot.positive).toLowerCase();
    const unnamed = names.filter((name) => name && !lowered.includes(name.toLowerCase()));
    if (unnamed.length) {
      add('cast-naming', `正向里没有出现角色名（${unnamed.join('、')}），通用人物词认不出是谁；请直接写角色名`);
    }
    if (entries.length >= 2 && !pair && !tags.some((tag) => COUNT_TAG.test(tag))) {
      add('cast-count', `已绑定 ${entries.length} 个角色但正向没写明人数，容易多画一个人；请写明 2girls、2boys 或 1girl, 1boy`);
    }
    for (const message of bleed(shot.characters || [], entries)) add('character-bleed', `${message}，请把这条标签放回本人条目`);
  }
  return issues;
}

export const assistantPlanRevision = (plan) => JSON.stringify(plan);

export function fixAssistantPlan(plan, issueId, { target = null, shotIndex = 0, revision } = {}) {
  if (revision !== assistantPlanRevision(plan)) throw new Error('草稿已改变，请重新检查后修正');
  const issue = checkAssistantPlan(plan, { target, shotIndex }).find((row) => row.id === issueId);
  if (!issue?.fix) throw new Error('该问题需要手动核对');
  const next = structuredClone(plan), shot = illustrationPlans(next)[shotIndex];
  if (issue.fix === 'deduplicate') shot[issue.field] = lintPromptField(shot[issue.field]).corrected;
  if (issue.fix === 'clear-anchor') delete shot.anchor;
  if (issue.fix === 'restore-character') {
    const entry = next.characterScene.entries.find((row) => row.profileId === issue.field);
    shot.characters ||= [];
    shot.characters.push({ profileId: entry.profileId, action: entry.action || '', expression: entry.expression || '', appearance: '', outfit: '', negative: '' });
  }
  syncPrimaryIllustration(next);
  return next;
}
