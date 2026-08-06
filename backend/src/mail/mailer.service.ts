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
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST ?? 'mailpit';
    const port = Number(process.env.SMTP_PORT ?? 1025);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;

    this.from =
      process.env.MAIL_FROM ?? 'CommunityHub <no-reply@communityhub.local>';

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
    this.transporter.close();
  }
}
