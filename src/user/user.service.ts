import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon from 'argon2';

@Injectable()
export class UserService {
  constructor(private readonly prismaService: PrismaService) {}

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
}
