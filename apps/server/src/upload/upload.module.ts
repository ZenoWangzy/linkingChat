// apps/server/src/upload/upload.module.ts
import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

const MinioClientProvider: Provider = {
  provide: 'MINIO_CLIENT',
  useFactory: (configService: ConfigService) => {
    return new MinioClient({
      endPoint: configService.get('MINIO_ENDPOINT') || 'localhost',
      port: parseInt(configService.get('MINIO_PORT') || '9008', 10),
      useSSL: configService.get('MINIO_USE_SSL') === 'true',
      accessKey: configService.get('MINIO_ACCESS_KEY') || 'minioadmin',
      secretKey: configService.get('MINIO_SECRET_KEY') || 'minioadmin',
    });
  },
  inject: [ConfigService],
};

@Module({
  providers: [UploadService, MinioClientProvider],
  controllers: [UploadController],
  exports: [UploadService],
})
export class UploadModule {}
