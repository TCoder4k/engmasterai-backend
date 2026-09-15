import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import type { AuthenticatedRequest } from '../auth/types/authenticated-request.type';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import { PaymentRateLimitGuard } from './rate-limit/payment-rate-limit.guard';
import { PaymentRateLimit } from './rate-limit/payment-rate-limits.decorator';
import { SepayWebhookGuard } from './sepay-webhook.guard';
import { PaymentWebhookRateLimitGuard } from './rate-limit/payment-webhook-rate-limit.guard';

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * Identity and price both come from the server — `dto` carries only
   * `plan`, never an amount. Returns the existing live order (200) if one
   * already exists for this user+plan, or a brand-new one (201) otherwise —
   * see PaymentService.createOrReusePayment.
   */
  @UseGuards(JwtAuthGuard, PaymentRateLimitGuard)
  @PaymentRateLimit({ kind: 'create', max: 5, windowSeconds: 300 })
  @Post()
  async createPayment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { dto: presentation, created } =
      await this.paymentService.createOrReusePayment(req.user.userId, dto.plan);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return presentation;
  }

  /** Owner-only — a non-owner or unknown id both report 404, never 403. */
  @UseGuards(JwtAuthGuard, PaymentRateLimitGuard)
  @PaymentRateLimit({ kind: 'status', max: 60, windowSeconds: 60 })
  @Get(':id')
  async getPayment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.paymentService.getOwnedPayment(req.user.userId, id);
  }

  /**
   * Server-to-server — deliberately NOT behind JwtAuthGuard. SepayWebhookGuard
   * authenticates the request (HMAC-SHA256, see sepay-webhook-verifier.service.ts)
   * BEFORE PaymentWebhookRateLimitGuard's IP-keyed bucket is ever touched, so
   * unsigned/forged traffic cannot consume it — order matters here.
   *
   * Always responds 200 once authenticated and parsed, regardless of business
   * outcome (unmatched code, wrong amount, already-paid duplicate, or a real
   * activation) — a business-logic mismatch can't be fixed by SePay retrying,
   * so its retry budget isn't wasted on one. Only a real authentication or
   * validation failure (401/400) is reported as an error.
   */
  @UseGuards(SepayWebhookGuard, PaymentWebhookRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @Post('webhooks/sepay')
  async handleSepayWebhook(@Body() dto: SepayWebhookDto) {
    await this.paymentService.processSepayWebhook(dto);
    return { success: true };
  }
}
