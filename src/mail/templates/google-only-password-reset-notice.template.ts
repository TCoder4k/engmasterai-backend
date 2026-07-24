import {
  GoogleOnlyPasswordResetNoticeTemplateVariables,
  RenderedEmail,
} from '../mail.types';
import { escapeHtml } from './email-template-renderer';

/**
 * No link, no token — see the "Google-Only Account Policy" section of
 * docs/sprints/sprint-02C-password-recovery.md for why this is safe to send
 * without weakening enumeration-resistance (the API response is unaffected
 * either way; only this account's own already-Google-verified mailbox ever
 * sees the distinguishing content).
 */
export const renderGoogleOnlyPasswordResetNoticeTemplate = (
  variables: GoogleOnlyPasswordResetNoticeTemplateVariables,
): RenderedEmail => {
  const safeName = escapeHtml(variables.name);

  const subject = 'Yêu cầu đặt lại mật khẩu — Tài khoản dùng Google';

  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Xin chào ${safeName},</h1>
      <p style="font-size: 15px; line-height: 1.6;">
        Có người vừa yêu cầu đặt lại mật khẩu cho địa chỉ email này. Tuy nhiên, tài khoản
        EngMasterAI của bạn đăng nhập bằng Google và hiện không có mật khẩu để đặt lại.
      </p>
      <p style="font-size: 15px; line-height: 1.6;">
        Vui lòng tiếp tục đăng nhập bằng nút "Tiếp tục với Google" như bình thường.
      </p>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        Nếu bạn không phải là người thực hiện yêu cầu này, bạn có thể bỏ qua email này — không
        có hành động nào được thực hiện trên tài khoản của bạn.
      </p>
    </div>
  </body>
</html>`;

  const text = `Xin chào ${variables.name},

Có người vừa yêu cầu đặt lại mật khẩu cho địa chỉ email này. Tuy nhiên, tài khoản EngMasterAI của bạn đăng nhập bằng Google và hiện không có mật khẩu để đặt lại.

Vui lòng tiếp tục đăng nhập bằng "Tiếp tục với Google" như bình thường.

Nếu bạn không phải là người thực hiện yêu cầu này, bạn có thể bỏ qua email này — không có hành động nào được thực hiện trên tài khoản của bạn.`;

  return { subject, html, text };
};
