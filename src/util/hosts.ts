/**
 * Which hosts count as Brevo.
 *
 * Shared by clustering and by verification. Verification needs it because a
 * third-party widget answering the same path would otherwise be enough to stamp
 * an action `verified`.
 */

const BREVO_HOSTS = /(?:\.|^)(?:brevo\.com|sendinblue\.com)$/i;

export function isBrevoHost(url: string): boolean {
  try {
    return BREVO_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
