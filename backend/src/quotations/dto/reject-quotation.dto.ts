import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { QUOTATION_REJECT_REASON_MAX_LENGTH } from './create-quotation.dto';

export class RejectQuotationDto {
  @ApiPropertyOptional({ maxLength: QUOTATION_REJECT_REASON_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTATION_REJECT_REASON_MAX_LENGTH)
  reason?: string;
}
