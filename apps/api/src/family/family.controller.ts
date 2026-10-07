import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ChildSessionInput,
  CreateChildInput,
  DeviceTokenInput,
  UpdateChildInput,
  UpdateDeviceInput,
  UpdateFamilyInput,
} from '@swag/protocol';
import { ClientIp, CurrentPrincipal, Public, Scopes } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { FamilyService } from './family.service';

@Controller()
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get('family')
  get(@CurrentPrincipal() p: Principal) {
    return this.family.getFamily(p);
  }

  @Patch('family')
  update(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(UpdateFamilyInput)) body: UpdateFamilyInput) {
    return this.family.updateFamily(p, body);
  }

  @Get('children')
  async listChildren(@CurrentPrincipal() p: Principal) {
    return (await this.family.getFamily(p)).children;
  }

  @Post('children')
  createChild(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(CreateChildInput)) body: CreateChildInput) {
    return this.family.createChild(p, body);
  }

  @Patch('children/:id')
  updateChild(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(UpdateChildInput)) body: UpdateChildInput,
  ) {
    return this.family.updateChild(p, id, body);
  }

  @Delete('children/:id')
  @HttpCode(204)
  async deleteChild(@CurrentPrincipal() p: Principal, @Param('id', UuidParam) id: string) {
    await this.family.deleteChild(p, id);
  }

  @Get('devices')
  listDevices(@CurrentPrincipal() p: Principal) {
    return this.family.listDevices(p);
  }

  @Patch('devices/:id')
  updateDevice(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) id: string,
    @Body(new ZodPipe(UpdateDeviceInput)) body: UpdateDeviceInput,
  ) {
    return this.family.updateDevice(p, id, body);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async revokeDevice(@CurrentPrincipal() p: Principal, @Param('id', UuidParam) id: string) {
    await this.family.revokeDevice(p, id);
  }

  // --- the tablet's own endpoints

  @Public()
  @Post('device/token')
  @HttpCode(200)
  deviceToken(@Body(new ZodPipe(DeviceTokenInput)) body: DeviceTokenInput, @ClientIp() ip: string) {
    return this.family.issueDeviceToken(body, ip);
  }

  @Scopes('device')
  @Get('device/profiles')
  deviceProfiles(@CurrentPrincipal() p: Principal) {
    return this.family.deviceProfiles(p);
  }

  @Scopes('device')
  @Post('device/child-session')
  @HttpCode(200)
  childSession(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(ChildSessionInput)) body: ChildSessionInput) {
    return this.family.startChildSession(p, body);
  }
}
