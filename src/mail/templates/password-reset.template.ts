import { PasswordResetTemplateVariables, RenderedEmail } from '../mail.types';
import { escapeHtml } from './email-template-renderer';

/**
 * Pure string-building — no I/O. Same escaping convention as
 * email-verification.template.ts: `name` is the only user-controlled value
 * interpolated, and is HTML-escaped; `resetUrl` is built server-side from
 * FRONTEND_APP_URL + a generated token, not independently escaped.
 */
export const renderPasswordResetTemplate = (
  variables: PasswordResetTemplateVariables,
): RenderedEmail => {
  const safeName = escapeHtml(variables.name);
  const { resetUrl, expiresInMinutes } = variables;

  const subject = 'Đặt lại mật khẩu EngMasterAI';

  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Xin chào ${safeName},</h1>
      <p style="font-size: 15px; line-height: 1.6;">
        Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản EngMasterAI của bạn.
        Nhấn vào nút bên dưới để chọn mật khẩu mới.
      </p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold; display: inline-block;">
          Đặt lại mật khẩu
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        Liên kết này sẽ hết hạn sau ${expiresInMinutes} phút và chỉ có thể sử dụng một lần.
        Nếu bạn không yêu cầu đặt lại mật khẩu, bạn có thể bỏ qua email này — mật khẩu của
        bạn sẽ không thay đổi.
      </p>
    </div>
  </body>
</html>`;

  const text = `Xin chào ${variables.name},

Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản EngMasterAI của bạn. Mở liên kết dưới đây để chọn mật khẩu mới:

${resetUrl}

Liên kết này sẽ hết hạn sau ${expiresInMinutes} phút và chỉ có thể sử dụng một lần. Nếu bạn không yêu cầu đặt lại mật khẩu, bạn có thể bỏ qua email này — mật khẩu của bạn sẽ không thay đổi.`;

  return { subject, html, text };
};
