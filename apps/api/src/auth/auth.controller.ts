import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { LoginInput, RefreshInput, RegisterInput } from '@swag/protocol';
import { z } from 'zod';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { ClientIp, CurrentPrincipal, Public } from './decorators';
import type { Principal } from './principal';
import { TokensService } from './tokens.service';

const LogoutInput = z.object({ refresh_token: z.string().max(200).optional() }).default({});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post('register')
  register(@Body(new ZodPipe(RegisterInput)) body: RegisterInput, @ClientIp() ip: string) {
    return this.auth.register(body, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginInput)) body: LoginInput, @ClientIp() ip: string) {
    return this.auth.login(body, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(RefreshInput)) body: RefreshInput, @ClientIp() ip: string) {
    await this.rateLimit.consume(`refresh-ip:${ip}`, 120, 900);
    return { tokens: await this.tokens.rotateRefreshToken(body.refresh_token) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodPipe(LogoutInput)) body: z.infer<typeof LogoutInput>,
  ) {
    await this.auth.logout(principal, body.refresh_token);
  }
}
