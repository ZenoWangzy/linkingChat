// apps/server/src/upload/upload.module.ts
import { Module, Provider } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';

const MinioClientProvider: Provider = {
  provide: 'MINIO_CLIENT',
  useFactory: () => {
    // MinIO client will be configured in Task #10
    return null;
  },
};

@Module({
  providers: [UploadService, MinioClientProvider],
  controllers: [UploadController],
  exports: [UploadService],
})
export class UploadModule {}
