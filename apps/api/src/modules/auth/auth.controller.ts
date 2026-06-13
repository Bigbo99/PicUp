import { Body, Controller, Get, Headers, Inject, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthCredentialsDto, AuthProfileUpdateDto, EmailAuthStartDto, EmailAuthVerifyDto, WechatAuthCallbackDto } from './dto';
import { AuthGuard } from './auth.guard';
import type { AuthenticatedRequest } from './auth.types';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.me(req, res);
  }

  @Post('register')
  register(@Body() body: AuthCredentialsDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(body, res);
  }

  @Post('email/start')
  startEmail(@Body() body: EmailAuthStartDto) {
    return this.auth.startEmailAuth(body);
  }

  @Post('email/verify')
  verifyEmail(@Body() body: EmailAuthVerifyDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyEmailAuth(body, res);
  }

  @Post('login')
  login(@Body() body: AuthCredentialsDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body, res);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res);
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  updateProfile(@Body() body: AuthProfileUpdateDto, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.updateProfile(req, body, res);
  }

  @Post('wechat/start')
  startWechat() {
    return this.auth.startWechatAuth();
  }

  @Get('wechat/status')
  wechatStatus(@Query('state') state: string, @Res({ passthrough: true }) res: Response) {
    return this.auth.getWechatStatus(state, res);
  }

  @Post('wechat/callback')
  wechatCallback(
    @Body() body: WechatAuthCallbackDto,
    @Headers('x-picup-wechat-secret') secret?: string
  ) {
    return this.auth.confirmWechatAuth(body, secret);
  }
}
