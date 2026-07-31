import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadTools } from './upload.tools';

/**
 * Planilhas enviadas pelo cliente no chat.
 *
 * Exporta o UploadService porque o ChatController recebe o arquivo — a rota
 * fica junto do chat, que e onde o usuario esta.
 */
@Module({
  providers: [UploadService, UploadTools],
  exports: [UploadService],
})
export class UploadsModule {}
