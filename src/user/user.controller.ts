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
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard, RolesGuard } from '../auth/guard';
import { Roles } from '../auth/decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  //Lấy ra tất cả người dùng trong hệ thống
  @Get()
  @Roles(UserRole.ADMIN)
  async findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.userService.findAll(page, limit);
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
  @Put('me')
  async updateMe(@Req() req, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(req.user.userId, updateUserDto);
  }
  
  //Admin cập nhật thông tin user bất kỳ
  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(id, updateUserDto);
  }
  //Admin xoá người dùng 
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.remove(id);
  }
}
