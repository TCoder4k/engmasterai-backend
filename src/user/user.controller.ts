import {
  Controller,
  Get,
  Put,
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
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import {
  UpdateProfileDto,
  AdminUpdateUserDto,
  ChangePasswordDto,
  QueryUserDto,
} from './dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

// The app-wide ValidationPipe (main.ts) doesn't enable `transform`, so query
// string values ("5") wouldn't be coerced to numbers for QueryUserDto's
// @Type() decorators. Scoping a transform-enabled pipe to just this @Query()
// param mirrors CourseController's queryPipe instead of changing global
// validation behavior for every other module.
const queryPipe = new ValidationPipe({ transform: true });

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  //Lấy ra tất cả người dùng trong hệ thống
  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(@Query(queryPipe) query: QueryUserDto) {
    return this.userService.findAll(query.page, query.limit);
  }

  //Xem thông tin bản thân - ALL authenticated users can access
  @Get('me')
  async getMe(@Req() req) {
    return this.userService.findOne(req.user.userId);
  }
  
  //Xem chi tiết thông tin 1 người dùng bất kỳ
  @Get(':id')
  @Roles(UserRole.ADMIN)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOne(id);
  }

  //Cập nhật thông tin bản thân - ALL authenticated users can access
  // Uses UpdateProfileDto (no role/level/totalPoints) so a self-update can
  // never escalate privilege — see UserService.updateProfile.
  @Put('me')
  async updateMe(@Req() req, @Body() updateProfileDto: UpdateProfileDto) {
    return this.userService.updateProfile(req.user.userId, updateProfileDto);
  }

  //Upload avatar cho bản thân - ALL authenticated users can access
  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are allowed (JPEG, PNG, WebP)');
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
    @Req() req,
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
