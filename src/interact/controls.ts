/**
 * Classifying a control by its visible label.
 *
 * Guessing selectors per module failed outright, so discovery enumerates
 * whatever controls a page actually has and decides what to do from the label.
 * That makes this classification the safety boundary. It covers English and
 * Portuguese, because Brevo renders this account in pt-BR.
 *
 * Two separate categories, because they carry very different costs:
 *
 * - **destructive** — deletes, archives, sends, publishes. Recoverable: the
 *   data was `catalog-test-*` fixtures and can be recreated. Enabled by the
 *   operator (`allowDestructive`), because these flows are a large part of what
 *   a catalog of business actions is *for*.
 * - **money** — upgrades, purchases, plan selection, closing the account.
 *   Not recoverable by re-running anything: it bills a card or destroys the
 *   account under test. Blocked unless explicitly allowed, separately.
 *
 * An unrecognised label is treated as clickable, because that is where
 * undiscovered functionality lives.
 */

export type ControlKind =
  /** Bills the account or destroys it. Blocked unless `allowMoney`. */
  | 'money'
  /** Deletes, archives, sends, publishes. Blocked unless `allowDestructive`. */
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
 * Anything that could change what the account pays, or end the account.
 *
 * Found the hard way: an exploration run clicked "Selecione Professional" and
 * "Atualizar" on a usage page before this group existed. `atualizar` is
 * ambiguous in Portuguese — "refresh" or "upgrade" — and it appears on Brevo's
 * plan pages, so it lives here. Losing a refresh click costs nothing.
 */
const MONEY = [
  /\b(?:upgrade|downgrade|subscribe|purchase|buy|checkout|billing|pay(?:ment)?)\b/i,
  /\b(?:add|buy) credits\b/i,
  /\bstart (?:a )?(?:free )?trial\b/i,
  /\b(?:professional|enterprise|premium|business plan|starter plan)\b/i,
  /\b(?:close|delete|cancel) (?:my )?(?:account|plan|subscription)\b/i,
  /\b(?:atualizar|assinar|comprar|pagar|pagamento|contratar|cr[ée]ditos)\b/i,
  /\bplano\b/i,
  /\b(?:avalia[çc][ãa]o|teste) grat/i,
  /\b(?:encerrar|excluir|cancelar) (?:minha )?(?:conta|assinatura)\b/i,
];

/** Destroys or dispatches data. Recoverable by recreating a fixture. */
const DESTRUCTIVE = [
  /\b(?:delete|remove|discard|erase|destroy|wipe|purge)\b/i,
  /\b(?:archive|deactivate|disable|revoke|unlink|disconnect|unsubscribe)\b/i,
  /\bsend\b(?!\s*(?:a\s*)?test)/i,
  /\b(?:publish|go live|activate)\b/i,
  /\b(?:reset|regenerate) (?:key|password|api)\b/i,
  /\bblock(?:list)?\b/i,
  /\b(?:excluir|remover|apagar|deletar|descartar)\b/i,
  /\b(?:arquivar|desativar|desabilitar|revogar|desconectar|descadastrar)\b/i,
  /\benviar\b(?!\s*(?:um\s*)?teste)/i,
  /\b(?:publicar|ativar|iniciar)\b/i,
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

export function isMoneyLabel(label: string): boolean {
  return MONEY.some((pattern) => pattern.test(label));
}

export function isDestructiveLabel(label: string): boolean {
  return DESTRUCTIVE.some((pattern) => pattern.test(label));
}

export function classifyControl(label: string): ControlKind {
  const text = label.trim();
  if (text.length === 0) return 'unknown';

  // Money outranks destructive, which outranks every other reading of the
  // same label: "Save and send" is destructive, "Upgrade and save" is money.
  if (isMoneyLabel(text)) return 'money';
  if (isDestructiveLabel(text)) return 'destructive';
  if (OPEN.some((p) => p.test(text))) return 'open';
  if (SUBMIT.some((p) => p.test(text))) return 'submit';
  if (DISMISS.some((p) => p.test(text))) return 'dismiss';
  if (NAVIGATE.some((p) => p.test(text))) return 'navigate';
  return 'unknown';
}

export type ExplorePolicy = {
  /** Click deletes, archives, sends and publishes. */
  allowDestructive: boolean;
  /** Click upgrades, purchases and account closure. Separate on purpose. */
  allowMoney: boolean;
};

export const CONSERVATIVE: ExplorePolicy = { allowDestructive: false, allowMoney: false };

export function isExplorable(label: string, policy: ExplorePolicy): boolean {
  const kind = classifyControl(label);
  if (kind === 'money') return policy.allowMoney;
  if (kind === 'destructive') return policy.allowDestructive;
  // Never abandon a form we are part-way through filling.
  return kind !== 'dismiss';
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
  if (['checkbox', 'radio', 'file', 'hidden', 'submit', 'button'].includes(field.type)) return null;

  return fx.listName();
}
