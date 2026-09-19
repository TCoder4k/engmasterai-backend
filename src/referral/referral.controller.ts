import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { ReferralService } from './referral.service';
import { RedeemReferralDto } from './dto/redeem-referral.dto';

@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('my-code')
  async getMyCode(@Req() req: AuthenticatedRequest) {
    return this.referralService.getOrCreateCode(req.user.userId);
  }

  @Post('redeem')
  @HttpCode(HttpStatus.NO_CONTENT)
  async redeem(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RedeemReferralDto,
  ): Promise<void> {
    await this.referralService.redeem(req.user.userId, dto.code);
  }
}
