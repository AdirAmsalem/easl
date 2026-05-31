import type { Env } from "../types";

/**
 * Injectable email sender. The serve handler and the auth factory only depend on
 * this interface, so tests can swap in a mock that records calls instead of
 * delivering real mail. The default production implementation uses the
 * Cloudflare Email Service binding (`env.EMAIL.send`).
 */
export interface EmailSender {
  send(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<void>;
}

/**
 * Default sender backed by the Cloudflare Email Service binding (CES).
 *
 * Requires the Workers Paid plan and a `[[send_email]]` binding named `EMAIL`.
 * If the binding is absent (local dev without CES, or a misconfigured deploy),
 * falls back to a console sender so the flow never silently swallows the link —
 * the magic link is logged as a structured event for local testing.
 */
export function makeEmailSender(env: Env): EmailSender {
  const from = `easl <no-reply@${env.DOMAIN}>`;

  if (!env.EMAIL) {
    return consoleEmailSender;
  }

  const binding = env.EMAIL;
  return {
    async send(message) {
      await binding.send({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      console.log(JSON.stringify({ event: "email_sent", to: message.to, subject: message.subject }));
    },
  };
}

/**
 * No-op/console sender used when no `EMAIL` binding is configured. Logs the
 * message (including the magic link, which lives in `text`) as a structured
 * event so it can be picked up from `wrangler tail` during local development.
 * Never used in tests — tests inject their own recording sender.
 */
export const consoleEmailSender: EmailSender = {
  async send(message) {
    console.log(JSON.stringify({ event: "email_console", to: message.to, subject: message.subject, text: message.text }));
  },
};
