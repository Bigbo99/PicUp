import { Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CreateRechargeOrderDto } from './dto';
import { PaymentsService } from './payments.service';

@Controller('api/payments')
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}

  @Get('plans')
  plans() {
    return this.payments.plans();
  }

  @Post('recharge')
  @UseGuards(AuthGuard)
  async createRecharge(@Body() body: CreateRechargeOrderDto, @Req() req: AuthenticatedRequest) {
    const user = await this.auth.requireUser(req);
    return this.payments.createRechargeOrder(user, body.planId);
  }

  @Get('orders/:id')
  @UseGuards(AuthGuard)
  async getOrder(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const user = await this.auth.requireUser(req);
    return this.payments.getOrder(id, user.id);
  }

  @Get('activity')
  @UseGuards(AuthGuard)
  async activity(@Req() req: AuthenticatedRequest) {
    const user = await this.auth.requireUser(req);
    return this.payments.activity(user.id);
  }

  @Post('wechat/notify')
  async wechatNotify(@Body() body: string | Record<string, unknown>, @Headers('content-type') contentType?: string) {
    return this.payments.handleWechatNotify(typeof body === 'string' ? body : String(body), contentType);
  }
}
