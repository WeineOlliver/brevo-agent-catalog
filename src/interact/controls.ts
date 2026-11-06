/**
 * Classifying a control by its visible label.
 *
 * Guessing selectors per module failed outright: every hardcoded English label
 * missed, because the account's UI is not necessarily in English. So discovery
 * enumerates whatever controls a page actually has and decides what to do from
 * the label — which means this classification is the safety boundary, and it
 * covers both English and Portuguese.
 *
 * The rule is deliberately asymmetric. An unrecognised label is treated as
 * safe to click, because that is where undiscovered functionality lives. A
 * label that looks destructive is never clicked, even if that costs coverage,
 * unless it is scoped to a fixture this harness created.
 */

export type ControlKind =
  /** Never click: deletes, sends to a real audience, or cannot be undone. */
  | 'destructive'
  /** Opens a form, panel or wizard — the interesting case. */
  | 'open'
  /** Submits a form that is already filled. */
  | 'submit'
  /** Moves around: tabs, pagination, navigation. */
  | 'navigate'
  /** Closes or abandons without saving. */
  | 'dismiss'
  /** Unrecognised. Clicked, because unknown labels are where discovery lives. */
  | 'unknown';

/**
 * Hard denylist. Matched before anything else and never clicked.
 *
 * `sendNow`/`enviar agora` is here rather than under `submit`: sending a
 * campaign reaches real recipients and is not reversible.
 */
const DESTRUCTIVE = [
  // English
  /\b(?:delete|remove|discard|erase|destroy|wipe|purge)\b/i,
  /\b(?:archive|deactivate|disable|revoke|unlink|disconnect|unsubscribe)\b/i,
  /\bsend\b(?!\s*(?:a\s*)?test)/i,
  /\b(?:publish|go live|activate campaign|start (?:campaign|automation|workflow))\b/i,
  /\b(?:close|cancel|downgrade|delete) (?:account|plan|subscription)\b/i,
  /\b(?:reset|regenerate) (?:key|password|api)\b/i,
  /\bblock(?:list)?\b/i,
  // Portuguese
  /\b(?:excluir|remover|apagar|deletar|descartar)\b/i,
  /\b(?:arquivar|desativar|desabilitar|revogar|desconectar|descadastrar)\b/i,
  /\benviar\b(?!\s*(?:um\s*)?teste)/i,
  /\b(?:publicar|ativar|iniciar)\b/i,
  /\bcancelar (?:conta|plano|assinatura)\b/i,
  /\bbloquear\b/i,
];

const OPEN = [
  /\b(?:create|add|new|import|upload|invite|connect|generate|duplicate|clone|edit|configure|customi[sz]e)\b/i,
  /\b(?:criar|adicionar|nov[oa]|importar|carregar|convidar|conectar|gerar|duplicar|editar|configurar|personalizar)\b/i,
];

const SUBMIT = [
  /\b(?:save|confirm|apply|submit|continue|finish|done|validate|send a test|send test)\b/i,
  /\b(?:salvar|confirmar|aplicar|enviar teste|continuar|concluir|finalizar|validar|pr[óo]xim[oa]|avan[çc]ar)\b/i,
];

const NAVIGATE = [
  /\b(?:next|previous|back|page|view all|see all|show more|filter|sort|search|details|overview|statistics)\b/i,
  /\b(?:pr[óo]xima|anterior|voltar|p[áa]gina|ver tod[oa]s|mostrar mais|filtrar|ordenar|buscar|detalhes|vis[ãa]o geral|estat[íi]sticas)\b/i,
];

const DISMISS = [
  /\b(?:cancel|close|dismiss|skip|not now|later|exit)\b/i,
  /\b(?:cancelar|fechar|dispensar|pular|agora n[ãa]o|depois|sair)\b/i,
];

/** The safety check, on its own so it can be asserted directly. */
export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE.some((pattern) => pattern.test(label));
}

export function classifyControl(label: string): ControlKind {
  const text = label.trim();
  if (text.length === 0) return 'unknown';

  // Destructive wins over every other reading of the same label.
  if (isDestructiveLabel(text)) return 'destructive';
  if (OPEN.some((p) => p.test(text))) return 'open';
  if (SUBMIT.some((p) => p.test(text))) return 'submit';
  if (DISMISS.some((p) => p.test(text))) return 'dismiss';
  if (NAVIGATE.some((p) => p.test(text))) return 'navigate';
  return 'unknown';
}

/**
 * A control is clickable during exploration unless it is destructive, or would
 * abandon a form we are in the middle of filling.
 */
export function isExplorable(label: string): boolean {
  const kind = classifyControl(label);
  return kind !== 'destructive' && kind !== 'dismiss';
}

export type FieldDescriptor = {
  type: string;
  name: string;
  placeholder: string;
  label: string;
};

/** Picks a fixture value appropriate to a form field. */
export function valueForField(
  field: FieldDescriptor,
  fx: { email(): string; listName(): string },
): string | null {
  const haystack = `${field.type} ${field.name} ${field.placeholder} ${field.label}`.toLowerCase();

  if (field.type === 'email' || /e-?mail/.test(haystack)) return fx.email();
  if (field.type === 'number' || /\b(?:count|quantity|limit|qtd|quantidade)\b/.test(haystack)) {
    return '1';
  }
  if (field.type === 'tel' || /\b(?:phone|telefone|celular)\b/.test(haystack)) return '5511999999999';
  if (field.type === 'url' || /\b(?:url|link|website|site)\b/.test(haystack)) {
    return 'https://example.com';
  }
  if (field.type === 'date') return '2027-01-01';
  // Checkboxes, radios, files and hidden inputs are left alone.
  if (['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(field.type)) return null;

  return fx.listName();
}
