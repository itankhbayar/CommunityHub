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

/** Which way mail leaves the process. Reported by /health; see MailerService. */
export type MailTransportKind = 'brevo-api' | 'smtp';

interface MailTransport {
  readonly kind: MailTransportKind;
  /** for /health — a hostname, never the credentials */
  readonly host: string;
  /** resolves with the provider's message id when it returns one */
  deliver(from: string, mail: OutgoingMail): Promise<string | undefined>;
  close(): void;
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

/**
 * Long enough for a slow provider, short enough that a hung request cannot
 * keep an unawaited send alive for the default 300s of socket patience.
 */
const BREVO_TIMEOUT_MS = 10_000;

/**
 * Splits `Name <addr@host>` into the shape Brevo's API wants. A bare address
 * is equally valid and keeps its own name field empty.
 */
function parseAddress(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match
    ? { name: match[1] || undefined, email: match[2] }
    : { email: from.trim() };
}

/**
 * Mail over Brevo's HTTPS API instead of SMTP.
 *
 * This exists because of a hosting constraint, not a preference: Render's free
 * instances block outbound traffic on ports 25, 465 and 587, so a perfectly
 * configured SMTP transport there connects to nothing and times out. Every
 * symptom of that points away from the cause — the API is healthy, /health
 * reports mail configured, and the provider's own log stays empty because
 * nothing ever reached it. Port 443 is not blocked, so the same account and
 * the same verified sender work unchanged over the API.
 *
 * Deliberately hand-rolled over `fetch` rather than pulling in Brevo's SDK:
 * this is one POST with three headers, and the SDK would be a dependency whose
 * only job is to hide it.
 */
class BrevoApiTransport implements MailTransport {
  readonly kind = 'brevo-api';
  readonly host = 'api.brevo.com';

  constructor(private readonly apiKey: string) {}

  async deliver(from: string, mail: OutgoingMail): Promise<string | undefined> {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseAddress(from),
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        ...(mail.html ? { htmlContent: mail.html } : {}),
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Brevo explains itself in the body — `unauthorized` for a bad key,
      // `sender_not_valid` for an address missing from Senders. Both are
      // configuration mistakes that look identical from the outside, so the
      // text is worth more in the log than the status code alone.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`Brevo API ${response.status}: ${detail}`);
    }

    const body = (await response.json().catch(() => ({}))) as {
      messageId?: string;
    };
    return body.messageId;
  }

  close(): void {
    // stateless — nothing pooled to tear down
  }
}

/** Plain SMTP. What compose uses against Mailpit, and what any provider takes. */
class SmtpTransport implements MailTransport {
  readonly kind = 'smtp';
  readonly host: string;
  private readonly transporter: Transporter;

  constructor(host: string, port: number, user?: string, pass?: string) {
    this.host = `${host}:${port}`;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      // Mailpit speaks plaintext on 1025; a real provider on 587 upgrades via
      // STARTTLS, which nodemailer does automatically when secure is false
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async deliver(from: string, mail: OutgoingMail): Promise<string | undefined> {
    // nodemailer types SentMessageInfo as `any`; narrowed to the one field
    // read here so the unsafe value stops at this line
    const info = (await this.transporter.sendMail({ from, ...mail })) as {
      messageId?: string;
    };
    return info.messageId;
  }

  close(): void {
    this.transporter.close();
  }
}

/**
 * One way out, chosen at boot: Brevo's API if `BREVO_API_KEY` is set, SMTP if
 * `SMTP_HOST` is, and disabled if neither is. In development compose points
 * SMTP at Mailpit, which accepts anything and shows it at
 * http://localhost:8025 — so a clean clone sends real mail with zero
 * credentials and no external service.
 *
 * The API wins when both are configured, because the case where both are set
 * is a deployment that tried SMTP, found the port blocked, and added the API
 * key — falling back to the blocked transport there would be perverse.
 *
 * Delivery failures are logged, never thrown. A dead mail server must not turn
 * registration into a 500, and the password-reset endpoint has to answer
 * identically whether or not an address exists — surfacing a send error there
 * would reintroduce exactly the account enumeration that endpoint avoids.
 * The cost of that choice is that a misconfigured mail setup is only visible in
 * the API logs, so the startup line below states where mail is going and
 * `status` puts the same fact on /health.
 *
 * With neither variable set, mail is **disabled** rather than attempted: the
 * body is written to the log and nothing is sent. There is no safe default
 * host — the one compose uses, `mailpit`, resolves only inside the compose
 * network, so defaulting to it makes every send from the host (a dev server,
 * the e2e suite) a multi-second DNS timeout that ends in a logged failure.
 * Disabled mode is honest about that and still lets you follow a link.
 */
@Injectable()
export class MailerService implements OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  /** null when mail is unconfigured — see the class comment */
  private readonly transport: MailTransport | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const host = process.env.SMTP_HOST?.trim();

    this.from =
      process.env.MAIL_FROM ?? 'CommunityHub <no-reply@communityhub.local>';

    if (apiKey) {
      this.transport = new BrevoApiTransport(apiKey);
    } else if (host) {
      this.transport = new SmtpTransport(
        host,
        Number(process.env.SMTP_PORT ?? 587),
        process.env.SMTP_USER,
        process.env.SMTP_PASSWORD,
      );
    } else {
      this.transport = null;
      this.logger.warn(
        'Neither BREVO_API_KEY nor SMTP_HOST is set — email is DISABLED. ' +
          'Messages will be written to this log instead of delivered, links ' +
          'included. Never run a real deployment this way.',
      );
      return;
    }

    this.logger.log(
      `mail -> ${this.transport.kind} (${this.transport.host}) as "${this.from}"`,
    );
  }

  /**
   * Whether mail can actually be sent, for /health to report.
   *
   * This exists because the failure it describes is otherwise invisible from
   * outside the process. /auth/forgot-password answers 202 whether or not
   * anything was sent — deliberately, so it cannot be used to enumerate
   * accounts — which means a deployment with no mail configured looks exactly
   * like a healthy one until somebody notices they never got their link.
   * Diagnosing that took three rounds of dashboard archaeology; a boolean on
   * the health endpoint would have taken one request.
   *
   * `transport` is here for the sequel to that afternoon: with SMTP blocked by
   * the host, `configured: true` was accurate and still useless, because the
   * question had become *which way* mail was leaving rather than whether it
   * was configured at all.
   *
   * A boolean, a transport name and a host, never the credentials.
   */
  get status(): {
    configured: boolean;
    transport: MailTransportKind | null;
    host: string | null;
  } {
    return {
      configured: this.transport !== null,
      transport: this.transport?.kind ?? null,
      host: this.transport?.host ?? null,
    };
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transport) {
      // the text body carries the link, which is the only part anyone needs
      this.logger.log(
        `[email disabled] would send "${mail.subject}" to ${mail.to}\n${mail.text}`,
      );
      return;
    }

    try {
      const id = await this.transport.deliver(this.from, mail);
      // the id is what makes a log line cross-referencable with the provider's
      // own dashboard, which is where the next delivery question gets answered
      this.logger.log(
        `sent "${mail.subject}" to ${mail.to}${id ? ` (${id})` : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `failed to send "${mail.subject}" to ${mail.to} via ${
          this.transport.kind
        }: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}
