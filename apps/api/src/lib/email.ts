import nodemailer from 'nodemailer';
import type { Env } from './env.js';

// Narrow interface so tests inject a recording fake (TESTING.md: mock only true externals).
export type Mailer = {
  send(mail: { to: string; subject: string; text: string }): Promise<void>;
};

export function createSmtpMailer(env: Env): Mailer {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: env.SMTP_FROM, ...mail });
    },
  };
}

export function verificationEmail(webBaseUrl: string, token: string) {
  return {
    subject: 'Verify your Foundry account',
    // FR-AUTH-02: account stays inactive until this link is clicked
    text: `Welcome to Foundry!\n\nVerify your college email to activate your account:\n${webBaseUrl}/verify-email?token=${token}\n\nThe link expires in 1 hour. If you didn't sign up, ignore this email.`,
  };
}

export function passwordResetEmail(webBaseUrl: string, token: string) {
  return {
    subject: 'Reset your Foundry password',
    // FR-AUTH-08: time-limited reset link
    text: `Someone requested a password reset for your Foundry account.\n\nReset it here:\n${webBaseUrl}/reset-password?token=${token}\n\nThe link expires in 1 hour. If this wasn't you, ignore this email.`,
  };
}
