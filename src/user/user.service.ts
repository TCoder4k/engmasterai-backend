import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto, AdminUpdateUserDto } from './dto/update-user.dto';
import { CloudinaryService } from '../shared/services/cloudinary.service';
import { Prisma } from '@prisma/client';
import * as argon from 'argon2';

// Fields safe to return to any caller — never includes `password`.
// emailVerifiedAt is selected only so toSafeUser() below can derive the
// boolean `emailVerified` — the raw timestamp itself is never returned to a
// client (Sprint 02B: avoids leaking exactly when verification happened).
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  totalPoints: true,
  level: true,
  createdAt: true,
  emailVerifiedAt: true,
};

type SafeUserRow = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

const toSafeUser = ({ emailVerifiedAt, ...rest }: SafeUserRow) => ({
  ...rest,
  emailVerified: emailVerifiedAt !== null,
});

const MAX_LIMIT = 100;

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAll(page?: number, limit?: number) {
    const take = Math.min(limit || 10, MAX_LIMIT);
    const skip = page ? (page - 1) * take : 0;

    const [users, total] = await Promise.all([
      this.prismaService.user.findMany({
        skip,
        take,
        select: SAFE_USER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.user.count(),
    ]);

    return {
      data: users.map(toSafeUser),
      meta: {
        total,
        page: page || 1,
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  async findOne(id: string) {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: SAFE_USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return toSafeUser(user);
  }

  async findByEmail(email: string) {
    return this.prismaService.user.findUnique({ where: { email } });
  }

  // Self-service update (PUT /users/me). Builds the Prisma `data` object
  // field-by-field from UpdateProfileDto — which itself has no role/level/
  // totalPoints fields — rather than spreading the DTO, so this method can
  // never write a privileged field even if the DTO shape changes later.
  async updateProfile(id: string, dto: UpdateProfileDto) {
    await this.findOne(id);
    await this.assertEmailAvailable(id, dto.email);

    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.password) data.password = await argon.hash(dto.password);

    const updated = await this.prismaService.user.update({
      where: { id },
      data,
      select: SAFE_USER_SELECT,
    });
    return toSafeUser(updated);
  }

  // Admin update (PUT /users/:id, ADMIN only). The only path that may write
  // role/level/totalPoints — kept in its own DTO and method so the
  // self-service path above can't be extended into a privilege escalation by
  // accident.
  async adminUpdate(id: string, dto: AdminUpdateUserDto) {
    await this.findOne(id);
    await this.assertEmailAvailable(id, dto.email);

    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.totalPoints !== undefined) data.totalPoints = dto.totalPoints;
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.password) data.password = await argon.hash(dto.password);

    const updated = await this.prismaService.user.update({
      where: { id },
      data,
      select: SAFE_USER_SELECT,
    });
    return toSafeUser(updated);
  }

  private async assertEmailAvailable(id: string, email?: string) {
    if (!email) return;

    const existingUser = await this.prismaService.user.findUnique({
      where: { email },
    });

    if (existingUser && existingUser.id !== id) {
      throw new ConflictException('Email is already in use');
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prismaService.user.delete({ where: { id } });
    return { message: 'User deleted successfully' };
  }

  async updatePoints(id: string, points: number) {
    const user = await this.findOne(id);
    const newTotalPoints = user.totalPoints + points;
    const newLevel = Math.floor(newTotalPoints / 100) + 1;

    return this.prismaService.user.update({
      where: { id },
      data: { totalPoints: newTotalPoints, level: newLevel },
      select: { id: true, totalPoints: true, level: true },
    });
  }

  async updateAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.findOne(userId);

    try {
      // Delete old avatar from Cloudinary if exists
      if (user.avatarUrl) {
        const publicId = this.extractPublicIdFromUrl(user.avatarUrl);
        if (publicId) {
          await this.cloudinaryService.deleteImage(publicId).catch(() => {
            // Ignore deletion errors
          });
        }
      }

      // Upload new avatar to Cloudinary
      const result = await this.cloudinaryService.uploadImage(file);

      // Update user avatar URL in database
      const updated = await this.prismaService.user.update({
        where: { id: userId },
        data: { avatarUrl: result.secure_url },
        select: SAFE_USER_SELECT,
      });
      return toSafeUser(updated);
    } catch (error) {
      throw new BadRequestException(
        'Failed to upload avatar: ' + error.message,
      );
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    // Get user with password
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Google-only accounts (Sprint 02A) have no local password to change.
    // Safe to be specific here (unlike login()'s generic failure messages) —
    // the caller already holds a valid session for this exact account.
    if (!user.password) {
      throw new BadRequestException(
        'This account signs in with Google and has no password to change',
      );
    }

    // Verify current password
    const isPasswordValid = await argon.verify(user.password, currentPassword);
    if (!isPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Check if new password is different from current
    const isSamePassword = await argon.verify(user.password, newPassword);
    if (isSamePassword) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    // Hash new password
    const hashedPassword = await argon.hash(newPassword);

    // Update password
    await this.prismaService.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return {
      message: 'Password changed successfully',
    };
  }

  private extractPublicIdFromUrl(url: string): string | null {
    try {
      // Extract public_id from Cloudinary URL
      // Format: https://res.cloudinary.com/cloud-name/image/upload/v123456/folder/public_id.ext
      const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.\w+$/);
      return matches ? matches[1] : null;
    } catch {
      return null;
    }
  }
}
