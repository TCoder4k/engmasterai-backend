import {
  PasswordResetSuccessTemplateVariables,
  RenderedEmail,
} from '../mail.types';
import { escapeHtml } from './email-template-renderer';

/**
 * Best-effort security notice sent after a successful reset (Sprint 02C,
 * "Security Notice Email") — same pattern Google/Microsoft/GitHub use.
 * Deliberately no reset/undo link: this email is not itself actionable, it
 * exists only so a legitimate owner learns quickly if a reset happened
 * without their knowledge, at which point the recourse is contacting
 * support, not clicking anything here.
 */
export const renderPasswordResetSuccessTemplate = (
  variables: PasswordResetSuccessTemplateVariables,
): RenderedEmail => {
  const safeName = escapeHtml(variables.name);

  const subject = 'Mật khẩu của bạn đã được thay đổi';

  const html = `<!doctype html>
<html lang="vi">
  <body style="font-family: Arial, sans-serif; background-color: #f8fafc; padding: 24px; color: #1e293b;">
    <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 32px;">
      <h1 style="font-size: 20px; margin-bottom: 16px;">Xin chào ${safeName},</h1>
      <p style="font-size: 15px; line-height: 1.6;">
        Mật khẩu tài khoản EngMasterAI của bạn vừa được thay đổi thành công. Mọi thiết bị
        đã đăng nhập trước đó đều đã được đăng xuất — bạn sẽ cần đăng nhập lại bằng mật
        khẩu mới.
      </p>
      <p style="font-size: 15px; line-height: 1.6; font-weight: bold;">
        Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ đội ngũ hỗ trợ ngay lập tức.
      </p>
    </div>
  </body>
</html>`;

  const text = `Xin chào ${variables.name},

Mật khẩu tài khoản EngMasterAI của bạn vừa được thay đổi thành công. Mọi thiết bị đã đăng nhập trước đó đều đã được đăng xuất — bạn sẽ cần đăng nhập lại bằng mật khẩu mới.

Nếu bạn không thực hiện thay đổi này, vui lòng liên hệ đội ngũ hỗ trợ ngay lập tức.`;

  return { subject, html, text };
};
