import { Logger } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * The transport, not the templates. Every assertion here corresponds to a
 * production failure that looked like success from the outside: a send that
 * never left the host, a provider rejection nobody saw, a key on a public
 * endpoint. The API payload is asserted field by field because Brevo answers
 * `400 sender_not_valid` to a subtly wrong body and `MailerService` swallows
 * that by design — a shape regression would otherwise reach an inbox nobody
 * checks.
 */
describe('MailerService', () => {
  const savedEnv = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.BREVO_API_KEY;
    delete process.env.SMTP_HOST;

    fetchMock = jest.fn();
    global.fetch = fetchMock;

    // the service narrates itself at boot; keep the suite output readable
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = savedEnv;
    jest.restoreAllMocks();
  });

  const ok = (body: unknown = { messageId: '<abc@brevo>' }) =>
    ({
      ok: true,
      status: 201,
      json: () => Promise.resolve(body),
    }) as Response;

  const mail = {
    to: 'reader@example.com',
    subject: 'Reset your CommunityHub password',
    text: 'link',
    html: '<p>link</p>',
  };

  /** the one request the Brevo transport makes, parsed */
  const sentRequest = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    };
  };

  describe('with BREVO_API_KEY', () => {
    beforeEach(() => {
      process.env.BREVO_API_KEY = 'xkeysib-test-key';
      process.env.MAIL_FROM = 'CommunityHub <no-reply@example.com>';
    });

    it('posts the message to Brevo over HTTPS', async () => {
      fetchMock.mockResolvedValue(ok());

      await new MailerService().send(mail);

      const { url, headers, body } = sentRequest();
      // port 443, which is the entire reason this transport exists
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(headers['api-key']).toBe('xkeysib-test-key');
      expect(body).toEqual({
        // split out of MAIL_FROM: Brevo takes name and address separately and
        // rejects the RFC 5322 string the SMTP path passes through verbatim
        sender: { name: 'CommunityHub', email: 'no-reply@example.com' },
        to: [{ email: 'reader@example.com' }],
        subject: 'Reset your CommunityHub password',
        textContent: 'link',
        htmlContent: '<p>link</p>',
      });
    });

    it('accepts a bare address as the sender', async () => {
      process.env.MAIL_FROM = 'no-reply@example.com';
      fetchMock.mockResolvedValue(ok());

      await new MailerService().send(mail);

      expect(sentRequest().body.sender).toEqual({
        email: 'no-reply@example.com',
      });
    });

    it('omits htmlContent when the message is text-only', async () => {
      fetchMock.mockResolvedValue(ok());

      await new MailerService().send({ ...mail, html: undefined });

      expect(sentRequest().body).not.toHaveProperty('htmlContent');
    });

    it('swallows a provider rejection instead of throwing', async () => {
      // 400 sender_not_valid is the likeliest real rejection: a MAIL_FROM that
      // was never verified under Senders. It must not propagate —
      // /auth/forgot-password answers 202 whether or not the address exists,
      // and an error escaping here would turn that into an enumeration oracle.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"code":"sender_not_valid"}'),
      });
      const logged = jest.spyOn(Logger.prototype, 'error');

      await expect(new MailerService().send(mail)).resolves.toBeUndefined();

      // swallowed, but never silent
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('sender_not_valid'),
      );
    });

    it('swallows a transport failure instead of throwing', async () => {
      fetchMock.mockRejectedValue(new Error('The operation was aborted'));
      const logged = jest.spyOn(Logger.prototype, 'error');

      await expect(new MailerService().send(mail)).resolves.toBeUndefined();

      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('The operation was aborted'),
      );
    });

    it('wins over SMTP when both are configured', async () => {
      // the state a deployment lands in after finding SMTP blocked and adding
      // the key: falling back to the blocked transport would undo the fix
      process.env.SMTP_HOST = 'smtp-relay.brevo.com';
      fetchMock.mockResolvedValue(ok());

      const mailer = new MailerService();
      await mailer.send(mail);

      expect(mailer.status.transport).toBe('brevo-api');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports the transport without the key', () => {
      expect(new MailerService().status).toEqual({
        configured: true,
        transport: 'brevo-api',
        host: 'api.brevo.com',
      });
    });
  });

  describe('with neither variable set', () => {
    it('disables mail rather than guessing a host', async () => {
      const mailer = new MailerService();

      await mailer.send(mail);

      expect(mailer.status).toEqual({
        configured: false,
        transport: null,
        host: null,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
