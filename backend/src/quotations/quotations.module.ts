import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationExpiryService } from './quotation-expiry.service';

@Module({
  imports: [RealtimeModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationExpiryService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
