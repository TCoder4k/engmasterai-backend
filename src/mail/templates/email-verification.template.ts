import {
  EmailVerificationTemplateVariables,
  RenderedEmail,
} from '../mail.types';
import { escapeHtml } from './email-template-renderer';

/**
 * Pure string-building — no I/O. `name` is the only user-controlled value
 * interpolated into the HTML body, and is HTML-escaped; `verifyUrl` is
 * built entirely server-side from FRONTEND_APP_URL + a generated token, so
 * it is not independently escaped (it is already a well-formed URL, not
 * free-text) but is still safe to place inside an `href` attribute here
 * because it is never derived from unescaped user input.
 */
export const renderEmailVerificationTemplate = (
  variables: EmailVerificationTemplateVariables,
): RenderedEmail => {
  const safeName = escapeHtml(variables.name);
  const { verifyUrl, expiresInMinutes } = variables;

  const subject = 'Xác nhận địa chỉ email của bạn — EngMasterAI';

  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Xin chào ${safeName},</h1>
      <p style="font-size: 15px; line-height: 1.6;">
        Cảm ơn bạn đã đăng ký tài khoản EngMasterAI. Vui lòng xác nhận địa chỉ email
        của bạn bằng cách nhấn vào nút bên dưới.
      </p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${verifyUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
          Xác nhận email
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        Liên kết này sẽ hết hạn sau ${expiresInMinutes} phút. Nếu bạn không tạo tài
        khoản này, bạn có thể bỏ qua email này.
      </p>
    </div>
  </body>
</html>`;

  const text = `Xin chào ${variables.name},

Cảm ơn bạn đã đăng ký tài khoản EngMasterAI. Vui lòng xác nhận địa chỉ email của bạn bằng cách mở liên kết dưới đây:

${verifyUrl}

Liên kết này sẽ hết hạn sau ${expiresInMinutes} phút. Nếu bạn không tạo tài khoản này, bạn có thể bỏ qua email này.`;

  return { subject, html, text };
};
