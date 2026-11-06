import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE,
  classifyControl,
  isDestructiveLabel,
  isExplorable,
  isMoneyLabel,
  valueForField,
} from '../../src/interact/controls.js';

const FULL = { allowDestructive: true, allowMoney: false };
const EVERYTHING = { allowDestructive: true, allowMoney: true };

const fx = { email: () => 'catalog-test-a@example.com', listName: () => 'catalog-test-list' };

describe('isDestructiveLabel', () => {
  it('catches English destructive labels', () => {
    for (const label of [
      'Delete',
      'Delete list',
      'Remove contact',
      'Archive campaign',
      'Revoke API key',
      'Unsubscribe',
      'Send now',
      'Send campaign',
      'Publish',
      'Regenerate key',
      'Blocklist',
    ]) {
      expect(isDestructiveLabel(label), label).toBe(true);
    }
  });

  it('catches Portuguese destructive labels, since the UI may not be in English', () => {
    for (const label of [
      'Excluir',
      'Excluir lista',
      'Remover contato',
      'Apagar',
      'Deletar',
      'Arquivar',
      'Desativar',
      'Revogar',
      'Enviar agora',
      'Enviar campanha',
      'Publicar',
      'Bloquear',
    ]) {
      expect(isDestructiveLabel(label), label).toBe(true);
    }
  });

  it('does not treat sending a test as destructive', () => {
    expect(isDestructiveLabel('Send a test')).toBe(false);
    expect(isDestructiveLabel('Send test email')).toBe(false);
    expect(isDestructiveLabel('Enviar teste')).toBe(false);
    expect(isDestructiveLabel('Enviar um teste')).toBe(false);
  });

  it('does not flag ordinary create and save labels', () => {
    for (const label of ['Create a list', 'Criar uma lista', 'Save', 'Salvar', 'Add a contact']) {
      expect(isDestructiveLabel(label), label).toBe(false);
    }
  });
});

describe('classifyControl', () => {
  it('classifies opening controls in both languages', () => {
    expect(classifyControl('Add a contact')).toBe('open');
    expect(classifyControl('Adicionar um contato')).toBe('open');
    expect(classifyControl('Criar uma lista')).toBe('open');
    expect(classifyControl('Import contacts')).toBe('open');
  });

  it('classifies submit controls in both languages', () => {
    expect(classifyControl('Save')).toBe('submit');
    expect(classifyControl('Salvar')).toBe('submit');
    expect(classifyControl('Confirmar')).toBe('submit');
    expect(classifyControl('Próximo')).toBe('submit');
  });

  it('classifies dismiss controls, which must not be clicked mid-form', () => {
    expect(classifyControl('Cancel')).toBe('dismiss');
    expect(classifyControl('Fechar')).toBe('dismiss');
  });

  it('classifies navigation', () => {
    expect(classifyControl('Next page')).toBe('navigate');
    expect(classifyControl('Ver todos')).toBe('navigate');
  });

  it('returns unknown for an unrecognised label, which is still explorable', () => {
    expect(classifyControl('Pipelines')).toBe('unknown');
    expect(isExplorable('Pipelines', CONSERVATIVE)).toBe(true);
  });

  it('lets destructive beat every other reading of the same label', () => {
    // "Save and send" contains a submit word and a destructive one.
    expect(classifyControl('Save and send')).toBe('destructive');
    expect(classifyControl('Salvar e enviar')).toBe('destructive');
  });

  it('treats an empty label as unknown', () => {
    expect(classifyControl('   ')).toBe('unknown');
  });
});

describe('isMoneyLabel', () => {
  it('catches plan and payment controls in both languages', () => {
    for (const label of [
      'Upgrade',
      'Selecione Professional',
      'Buy credits',
      'Start a free trial',
      'Checkout',
      'Close account',
      'Atualizar',
      'Uso e plano',
      'Assinar',
      'Comprar créditos',
      'Encerrar minha conta',
    ]) {
      expect(isMoneyLabel(label), label).toBe(true);
    }
  });

  it('does not flag ordinary product controls as money', () => {
    for (const label of ['Add a contact', 'Criar uma lista', 'Save', 'Delete list']) {
      expect(isMoneyLabel(label), label).toBe(false);
    }
  });

  it('outranks destructive when a label is both', () => {
    expect(classifyControl('Cancel subscription')).toBe('money');
    expect(classifyControl('Excluir minha conta')).toBe('money');
  });
});

describe('isExplorable', () => {
  it('refuses destructive under the conservative policy', () => {
    expect(isExplorable('Delete', CONSERVATIVE)).toBe(false);
    expect(isExplorable('Excluir', CONSERVATIVE)).toBe(false);
  });

  it('allows destructive when the operator has granted it', () => {
    expect(isExplorable('Delete', FULL)).toBe(true);
    expect(isExplorable('Excluir contato', FULL)).toBe(true);
    expect(isExplorable('Enviar agora', FULL)).toBe(true);
  });

  it('still refuses money even with destructive granted', () => {
    expect(isExplorable('Selecione Professional', FULL)).toBe(false);
    expect(isExplorable('Atualizar', FULL)).toBe(false);
    expect(isExplorable('Close account', FULL)).toBe(false);
  });

  it('allows money only when that is granted separately', () => {
    expect(isExplorable('Upgrade', EVERYTHING)).toBe(true);
  });

  it('never clicks a dismiss control, under any policy', () => {
    expect(isExplorable('Cancel', EVERYTHING)).toBe(false);
    expect(isExplorable('Fechar', EVERYTHING)).toBe(false);
  });

  it('allows open, submit, navigate and unknown under every policy', () => {
    for (const policy of [CONSERVATIVE, FULL, EVERYTHING]) {
      for (const label of ['Add a contact', 'Save', 'Next page', 'Pipelines']) {
        expect(isExplorable(label, policy), label).toBe(true);
      }
    }
  });
});

describe('valueForField', () => {
  it('uses a fixture email for an email field', () => {
    expect(valueForField({ type: 'email', name: '', placeholder: '', label: '' }, fx)).toContain('@');
    expect(
      valueForField({ type: 'text', name: 'userEmail', placeholder: '', label: '' }, fx),
    ).toContain('@');
    expect(valueForField({ type: 'text', name: '', placeholder: '', label: 'E-mail' }, fx)).toContain(
      '@',
    );
  });

  it('uses a fixture name for a plain text field', () => {
    expect(valueForField({ type: 'text', name: 'listName', placeholder: '', label: '' }, fx)).toBe(
      'catalog-test-list',
    );
  });

  it('uses safe values for numbers, urls, phones and dates', () => {
    expect(valueForField({ type: 'number', name: '', placeholder: '', label: '' }, fx)).toBe('1');
    expect(valueForField({ type: 'url', name: '', placeholder: '', label: '' }, fx)).toContain(
      'example.com',
    );
    expect(valueForField({ type: 'tel', name: '', placeholder: '', label: '' }, fx)).toMatch(/^\d+$/);
    expect(valueForField({ type: 'date', name: '', placeholder: '', label: '' }, fx)).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('leaves checkboxes, radios, files and hidden inputs alone', () => {
    for (const type of ['checkbox', 'radio', 'file', 'hidden', 'submit', 'button']) {
      expect(valueForField({ type, name: '', placeholder: '', label: '' }, fx), type).toBeNull();
    }
  });
});
