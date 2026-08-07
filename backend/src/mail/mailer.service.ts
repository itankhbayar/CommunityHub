import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  /** plain text body; every message must have one, HTML is the enhancement */
  text: string;
  html?: string;
}

/**
 * SMTP out, nothing else. In development compose points this at Mailpit, which
 * accepts anything and shows it at http://localhost:8025 — so a clean clone
 * sends real mail with zero credentials and no external service.
 *
 * Delivery failures are logged, never thrown. A dead mail server must not turn
 * registration into a 500, and the password-reset endpoint has to answer
 * identically whether or not an address exists — surfacing a send error there
 * would reintroduce exactly the account enumeration that endpoint avoids.
 * The cost of that choice is that a misconfigured SMTP host is only visible in
 * the API logs, so the startup line below states where mail is going.
 *
 * With SMTP_HOST unset, mail is **disabled** rather than attempted: the body is
 * written to the log and nothing is sent. There is no safe default host — the
 * one compose uses, `mailpit`, resolves only inside the compose network, so
 * defaulting to it makes every send from the host (a dev server, the e2e
 * suite) a multi-second DNS timeout that ends in a logged failure. Disabled
 * mode is honest about that and still lets you follow a link.
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  /** null when SMTP is unconfigured — see the class comment */
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST?.trim();
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    this.from =
      process.env.MAIL_FROM ?? 'CommunityHub <no-reply@communityhub.local>';

    if (!host) {
      this.transporter = null;
      this.logger.warn(
        'SMTP_HOST is not set — email is DISABLED. Messages will be written to ' +
          'this log instead of delivered, links included. Never run a real ' +
          'deployment this way.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // Mailpit speaks plaintext on 1025; a real provider on 587 upgrades via
      // STARTTLS, which nodemailer does automatically when secure is false
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    this.logger.log(`mail -> ${host}:${port} as "${this.from}"`);
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transporter) {
      // the text body carries the link, which is the only part anyone needs
      this.logger.log(
        `[email disabled] would send "${mail.subject}" to ${mail.to}\n${mail.text}`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, ...mail });
      this.logger.log(`sent "${mail.subject}" to ${mail.to}`);
    } catch (error) {
      this.logger.error(
        `failed to send "${mail.subject}" to ${mail.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
