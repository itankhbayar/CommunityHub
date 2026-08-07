import type { OutgoingMail } from '../../src/mail/mailer.service';

/**
 * Stands in for MailerService so tests can assert on what was actually mailed.
 *
 * This is the only way to get a usable token out of the system: only the hash
 * is stored, so the plaintext exists exclusively in the message body. Reading
 * it back from here means the tests exercise the real templates and the real
 * link format — a test that reached into VerificationTokenService for a token
 * would pass even if the mail went out with the wrong URL, or empty.
 */
export class RecordingMailer {
  readonly sent: OutgoingMail[] = [];

  send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }

  /** MailerService implements OnModuleDestroy; the app calls this on close. */
  onModuleDestroy(): void {}

  clear(): void {
    this.sent.length = 0;
  }

  get last(): OutgoingMail | undefined {
    return this.sent[this.sent.length - 1];
  }

  /** Every message sent to one address, oldest first. */
  to(address: string): OutgoingMail[] {
    return this.sent.filter((mail) => mail.to === address);
  }

  /**
   * Pulls the token out of the most recent message's link. Deliberately reads
   * the plain-text body, which is the part every mail client can render and
   * the part the templates promise always exists.
   */
  tokenFrom(path: 'reset-password' | 'verify-email'): string {
    const body = this.last?.text ?? '';
    const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(body);

    if (!match) {
      throw new Error(
        `no ${path} link in the last email; body was:\n${body || '(nothing sent)'}`,
      );
    }

    return match[1];
  }
}
