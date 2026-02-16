import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { GatewayModule } from './gateway/gateway.module';
import { FriendsModule } from './friends/friends.module';
import { ConversesModule } from './converses/converses.module';
import { MessagesModule } from './messages/messages.module';
import { UsersModule } from './users/users.module';
import { BotsModule } from './bots/bots.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    DevicesModule,
    GatewayModule,
    FriendsModule,
    ConversesModule,
    MessagesModule,
    UsersModule,
    BotsModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
