import type { ParsedCard } from '$kernel/importers/charaCard';
import { scanText, type Finding } from '$kernel/importers/scan';

export type FieldKey = 'name' | 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example' | 'system_prompt' | 'creator_notes';

export const FIELD_LABEL: Record<FieldKey, string> = {
  name: '名字', description: '描述', personality: '性格', scenario: '场景', first_mes: '开场白',
  mes_example: '示例对话', system_prompt: '作者系统提示', creator_notes: '作者备注',
};

/** 导入前检查的草稿：检查页和可疑项页共用这一份状态。 */
class InspectDraft {
  active = $state(false);
  avatar?: Blob;
  raw?: unknown;
  card?: ParsedCard;
  fields = $state<Record<FieldKey, string>>({ name: '', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', creator_notes: '' });
  ignored = $state<Record<string, boolean>>({});

  findings = $derived.by<(Finding & { key: string; label: string })[]>(() => {
    const out: (Finding & { key: string; label: string })[] = [];
    for (const [k, v] of Object.entries(this.fields)) {
      for (const f of scanText(k, v)) out.push({ ...f, key: `${k}:${f.kind}:${f.index}`, label: FIELD_LABEL[k as FieldKey] });
    }
    return out;
  });
  open = $derived(this.findings.filter((f) => !this.ignored[f.key]));

  start(card: ParsedCard, avatar?: Blob, raw?: unknown) {
    this.card = card; this.avatar = avatar; this.raw = raw;
    this.fields = {
      name: card.name, description: card.description, personality: card.personality, scenario: card.scenario,
      first_mes: card.firstMessage, mes_example: card.exampleDialogue, system_prompt: card.systemPrompt, creator_notes: card.creatorNotes,
    };
    this.ignored = {};
    this.active = true;
  }
  reset() { this.active = false; this.card = undefined; this.avatar = undefined; this.raw = undefined; this.ignored = {}; }

  getText(field: string): string { return this.fields[field as FieldKey] ?? ''; }
  setText(field: string, text: string) { this.fields[field as FieldKey] = text; }
}

export const draft = new InspectDraft();

/** 命中位置所在的那句话的范围（按句号、问号、感叹号、换行切） */
export function sentenceRange(text: string, index: number, length: number): [number, number] {
  const ends = /[。！？!?\n]/;
  let s = index;
  while (s > 0 && !ends.test(text[s - 1]!)) s--;
  let e = index + length;
  while (e < text.length && !ends.test(text[e]!)) e++;
  if (e < text.length) e++; // 把标点一起删
  return [s, e];
}
