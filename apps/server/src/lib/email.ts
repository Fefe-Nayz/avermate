import { Resend } from "resend";
import { env } from "./env";

/**
 * Transactional email.
 *
 * Templates are inline HTML on purpose: these five messages change once a year
 * and every mail client renders tables reliably. Copy exists in both languages
 * because the account's locale is the only thing the reader cares about.
 */

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type Locale = "en" | "fr";

interface Copy {
  subject: string;
  heading: string;
  body: string;
  footnote: string;
}

function layout(options: {
  heading: string;
  body: string;
  highlight?: string;
  action?: { label: string; url: string };
  footnote: string;
}): string {
  const year = new Date().getFullYear();
  const action = options.action
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
         <tr><td align="center" bgcolor="#18181b" style="border-radius:8px;">
           <a href="${options.action.url}" target="_blank" rel="noopener"
              style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
             ${options.action.label}
           </a>
         </td></tr>
       </table>`
    : "";

  const highlight = options.highlight
    ? `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
         <tr><td align="center" bgcolor="#f4f4f5" style="border-radius:10px;padding:16px 28px;">
           <span style="font-size:30px;font-weight:700;letter-spacing:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#18181b;">${options.highlight}</span>
         </td></tr>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;margin:0 16px;">
        <tr><td style="padding:28px 28px 0;">
          <img src="https://avermate.fr/icon512_maskable.png" alt="Avermate" width="36" style="display:block;border-radius:8px;" />
        </td></tr>
        <tr><td style="padding:20px 28px 0;">
          <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:650;">${options.heading}</h1>
        </td></tr>
        <tr><td style="padding:12px 28px 20px;">
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525b;">${options.body}</p>
          ${highlight}
          ${action}
          <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#a1a1aa;">${options.footnote}</p>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#a1a1aa;">© ${year} Avermate</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export type OtpKind =
  "email-verification" | "sign-in" | "forget-password" | "change-email";

const OTP_COPY: Record<Locale, Record<OtpKind, Copy>> = {
  en: {
    "email-verification": {
      subject: "Your Avermate verification code",
      heading: "Confirm your email address",
      body: "Welcome to Avermate. Enter the code below to finish setting up your account. It expires in 10 minutes.",
      footnote: "If you did not create an account, you can ignore this email.",
    },
    "sign-in": {
      subject: "Your Avermate sign-in code",
      heading: "Sign in to Avermate",
      body: "Use the code below to sign in. It expires in 10 minutes.",
      footnote: "If you did not try to sign in, change your password.",
    },
    "forget-password": {
      subject: "Reset your Avermate password",
      heading: "Reset your password",
      body: "Use the code below to choose a new password. It expires in 10 minutes.",
      footnote: "If you did not ask for this, you can ignore this email.",
    },
    "change-email": {
      subject: "Confirm your new Avermate address",
      heading: "Confirm your new address",
      body: "Enter the code below to move your account to this address. It expires in 10 minutes.",
      footnote: "If you did not ask for this, contact us immediately.",
    },
  },
  fr: {
    "email-verification": {
      subject: "Votre code de vérification Avermate",
      heading: "Confirmez votre adresse e-mail",
      body: "Bienvenue sur Avermate. Saisissez le code ci-dessous pour finaliser la création de votre compte. Il expire dans 10 minutes.",
      footnote: "Si vous n'avez pas créé de compte, ignorez cet e-mail.",
    },
    "sign-in": {
      subject: "Votre code de connexion Avermate",
      heading: "Connexion à Avermate",
      body: "Utilisez le code ci-dessous pour vous connecter. Il expire dans 10 minutes.",
      footnote:
        "Si vous n'êtes pas à l'origine de cette connexion, changez votre mot de passe.",
    },
    "forget-password": {
      subject: "Réinitialisez votre mot de passe Avermate",
      heading: "Réinitialisation du mot de passe",
      body: "Utilisez le code ci-dessous pour choisir un nouveau mot de passe. Il expire dans 10 minutes.",
      footnote: "Si vous n'avez rien demandé, ignorez cet e-mail.",
    },
    "change-email": {
      subject: "Confirmez votre nouvelle adresse Avermate",
      heading: "Confirmez votre nouvelle adresse",
      body: "Saisissez le code ci-dessous pour rattacher votre compte à cette adresse. Il expire dans 10 minutes.",
      footnote:
        "Si vous n'êtes pas à l'origine de cette demande, contactez-nous immédiatement.",
    },
  },
};

async function send(to: string, subject: string, html: string): Promise<void> {
  if (env.DISABLE_EMAIL || !resend) {
    console.info(`[email] ${subject} → ${to}`);
    return;
  }
  await resend.emails.send({
    from: `Avermate <${env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  });
}

export async function sendOtpEmail(input: {
  to: string;
  otp: string;
  kind: OtpKind;
  locale?: Locale;
}): Promise<void> {
  const copy = OTP_COPY[input.locale ?? "fr"][input.kind];
  if (env.DISABLE_EMAIL || !resend) {
    // OTPs are credentials. A disabled delivery adapter must not turn logs
    // into a second, long-lived delivery channel.
    console.info(`[email] OTP ${input.kind} delivery disabled`);
    return;
  }
  await send(
    input.to,
    copy.subject,
    layout({
      heading: copy.heading,
      body: copy.body,
      highlight: input.otp,
      footnote: copy.footnote,
    }),
  );
}

export async function sendEmailChangeConfirmation(input: {
  to: string;
  name: string;
  url: string;
  locale?: Locale;
}): Promise<void> {
  const french = (input.locale ?? "fr") === "fr";
  await send(
    input.to,
    french
      ? "Confirmez votre nouvelle adresse e-mail"
      : "Confirm your new email address",
    layout({
      heading: french
        ? "Confirmez votre nouvelle adresse"
        : "Confirm your new address",
      body: french
        ? `Bonjour ${input.name}, confirmez cette adresse pour qu'elle devienne celle de votre compte Avermate.`
        : `Hi ${input.name}, confirm this address so it becomes the one on your Avermate account.`,
      action: {
        label: french ? "Confirmer l'adresse" : "Confirm address",
        url: input.url,
      },
      footnote: french
        ? "Si vous n'êtes pas à l'origine de ce changement, contactez-nous immédiatement."
        : "If you did not request this change, contact us immediately.",
    }),
  );
}

export async function sendAccountDeletionConfirmation(input: {
  to: string;
  url: string;
  locale?: Locale;
}): Promise<void> {
  const french = (input.locale ?? "fr") === "fr";
  await send(
    input.to,
    french
      ? "Confirmez la suppression de votre compte"
      : "Confirm account deletion",
    layout({
      heading: french ? "Supprimer votre compte" : "Delete your account",
      body: french
        ? "Cette action supprime définitivement vos années, matières et notes. Elle est irréversible."
        : "This permanently removes your years, subjects and grades. It cannot be undone.",
      action: {
        label: french ? "Supprimer définitivement" : "Delete permanently",
        url: input.url,
      },
      footnote: french
        ? "Si vous n'avez rien demandé, ignorez cet e-mail : rien ne sera supprimé."
        : "If you did not ask for this, ignore this email — nothing will be deleted.",
    }),
  );
}
