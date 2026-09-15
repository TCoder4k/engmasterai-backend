import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  UseGuards,
  Req,
  Post,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { AdminStudentOverviewService } from './admin-student-overview.service';
import {
  UpdateProfileDto,
  AdminUpdateUserDto,
  ChangePasswordDto,
  QueryUserDto,
  UpdateUserStatusDto,
} from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Roles } from '../auth/decorators';
import { UserRole } from '@prisma/client';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';

// The app-wide ValidationPipe (main.ts) doesn't enable `transform`, so query
// string values ("5") wouldn't be coerced to numbers for QueryUserDto's
// @Type() decorators. Scoping a transform-enabled pipe to just this @Query()
// param mirrors CourseController's queryPipe instead of changing global
// validation behavior for every other module.
const queryPipe = new ValidationPipe({ transform: true });

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly adminStudentOverview: AdminStudentOverviewService,
  ) {}

  //Lấy ra tất cả người dùng trong hệ thống
  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(@Query(queryPipe) query: QueryUserDto) {
    return this.userService.findAll(query.page, query.limit, query.search);
  }

  // Admin student list — Sprint 15. Registered BEFORE @Get(':id') so
  // NestJS/Express matches this literal segment first; if it moved after
  // findOne(), a request to /users/overview would instead be routed to
  // findOne('overview') and 400 at ParseUUIDPipe.
  @Get('overview')
  @Roles(UserRole.ADMIN)
  async listOverview(@Query(queryPipe) query: QueryUserDto) {
    return this.adminStudentOverview.listOverview(
      query.page,
      query.limit,
      query.search,
      query.plan,
      query.status,
    );
  }

  //Xem thông tin bản thân - ALL authenticated users can access
  @Get('me')
  async getMe(@Req() req: AuthenticatedRequest) {
    return this.userService.findOne(req.user.userId);
  }

  //Xem chi tiết thông tin 1 người dùng bất kỳ
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOne(id);
  }

  // Admin student detail — Sprint 15. Deliberately separate from findOne()
  // above: this aggregates several other domains (roadmap progress, test
  // history, study time, speaking, payments) and must never make the
  // lightweight GET /users/:id (or GET /users/me, which shares its service
  // method) heavier.
  @Get(':id/overview')
  @Roles(UserRole.ADMIN)
  async getStudentOverview(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminStudentOverview.getDetail(id);
  }

  // Block / unblock — Sprint 15. An admin may not block their own currently
  // authenticated account (would otherwise let an admin lock themselves out
  // via their own token, with no one else able to reach this endpoint on
  // their behalf if they are the only admin). Unblocking self is harmless
  // and left unrestricted.
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async setStudentStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    if (!dto.isActive && id === req.user.userId) {
      throw new ForbiddenException('Admins cannot block their own account');
    }
    return this.adminStudentOverview.setActiveStatus(id, dto.isActive);
  }

  //Cập nhật thông tin bản thân - ALL authenticated users can access
  // Uses UpdateProfileDto (no role/level/totalPoints) so a self-update can
  // never escalate privilege — see UserService.updateProfile.
  @Put('me')
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(req.user.userId, updateProfileDto);
  }

  //Upload avatar cho bản thân - ALL authenticated users can access
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Only image files are allowed (JPEG, PNG, WebP)',
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File size must not exceed 10MB');
    }

    return this.userService.updateAvatar(req.user.userId, file);
  }

  //Đổi mật khẩu - ALL authenticated users can access
  @Post('me/password')
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(
      req.user.userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
  }

  //Admin cập nhật thông tin user bất kỳ (được phép đổi role/level/totalPoints)
  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
  ) {
    return this.userService.adminUpdate(id, adminUpdateUserDto);
  }
  //Admin xoá người dùng
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.remove(id);
  }
}
