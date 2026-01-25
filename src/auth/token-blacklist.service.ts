import { Injectable } from '@nestjs/common';

/**
 * Token Blacklist Service (In-Memory)
 * Quản lý danh sách các token đã bị vô hiệu hóa (logout)
 * Sử dụng in-memory Map để lưu trữ (phù hợp cho development)
 */
@Injectable()
export class TokenBlacklistService {
  // In-memory storage: Map<token, expiresAt>
  private blacklistedTokens: Map<string, number> = new Map();

  /**
   * Thêm token vào blacklist
   * @param token - JWT token cần vô hiệu hóa
   * @param expiresAt - Thời điểm token hết hạn (Unix timestamp in seconds)
   */
  addToBlacklist(token: string, expiresAt: number): void {
    const now = Math.floor(Date.now() / 1000);
    const ttl = expiresAt - now;

    if (ttl > 0) {
      this.blacklistedTokens.set(token, expiresAt);

      // Tự động xóa token khỏi blacklist sau khi hết hạn
      setTimeout(() => {
        this.blacklistedTokens.delete(token);
      }, ttl * 1000);
    }
  }

  /**
   * Kiểm tra token có bị blacklist không
   * @param token - JWT token cần kiểm tra
   * @returns true nếu token bị blacklist
   */
  isBlacklisted(token: string): boolean {
    const expiresAt = this.blacklistedTokens.get(token);

    if (!expiresAt) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);

    // Nếu token đã hết hạn, xóa khỏi blacklist
    if (now >= expiresAt) {
      this.blacklistedTokens.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Xóa token khỏi blacklist (nếu cần)
   * @param token - JWT token cần xóa
   */
  removeFromBlacklist(token: string): void {
    this.blacklistedTokens.delete(token);
  }

  /**
   * Dọn dẹp các token đã hết hạn (chạy định kỳ nếu cần)
   */
  cleanup(): void {
    const now = Math.floor(Date.now() / 1000);

    for (const [token, expiresAt] of this.blacklistedTokens.entries()) {
      if (now >= expiresAt) {
        this.blacklistedTokens.delete(token);
      }
    }
  }
}

