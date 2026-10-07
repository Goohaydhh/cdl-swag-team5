import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AllowlistController } from './access/allowlist.controller';
import { AllowlistService } from './access/allowlist.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { CoreModule } from './core.module';
import { FamilyController } from './family/family.controller';
import { FamilyService } from './family/family.service';
import { GdprController } from './gdpr/gdpr.controller';
import { GdprService } from './gdpr/gdpr.service';
import { RetentionService } from './gdpr/retention.service';
import { HealthController } from './health/health.controller';
import { GifsService } from './media/gifs.service';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { PairingController } from './pairing/pairing.controller';
import { PairingService } from './pairing/pairing.service';
import { PushController } from './push/push.controller';
import { RtGateway } from './realtime/rt.gateway';
import { PresenceService } from './status/presence.service';
import { StatusController } from './status/status.controller';
import { StatusService } from './status/status.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot(), CoreModule],
  controllers: [
    HealthController,
    AuthController,
    PairingController,
    FamilyController,
    StatusController,
    PushController,
    ChatController,
    MediaController,
    AllowlistController,
    GdprController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    PairingService,
    FamilyService,
    StatusService,
    PresenceService,
    ChatService,
    MediaService,
    GifsService,
    AllowlistService,
    GdprService,
    RetentionService,
    RtGateway,
  ],
})
export class AppModule {}
