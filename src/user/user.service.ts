import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CloudinaryService } from '../shared/services/cloudinary.service';
import * as argon from 'argon2';

@Injectable()
export class UserService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async findAll(page?: number, limit?: number) {
    const take = limit || 10;
    const skip = page ? (page - 1) * take : 0;

    const [users, total] = await Promise.all([
      this.prismaService.user.findMany({
        skip,
        take,
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          totalPoints: true,
          level: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.user.count(),
    ]);

    return {
      data: users,
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
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        totalPoints: true,
        level: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string) {
    return this.prismaService.user.findUnique({ where: { email } });
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.findOne(id);

    if (updateUserDto.email) {
      const existingUser = await this.prismaService.user.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser && existingUser.id !== id) {
        throw new ConflictException('Email is already in use');
      }
    }

    const data: any = { ...updateUserDto };
    if (updateUserDto.password) {
      data.password = await argon.hash(updateUserDto.password);
    }

    return this.prismaService.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        totalPoints: true,
        level: true,
        createdAt: true,
      },
    });
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
      return this.prismaService.user.update({
        where: { id: userId },
        data: { avatarUrl: result.secure_url },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          role: true,
          totalPoints: true,
          level: true,
          createdAt: true,
        },
      });
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
