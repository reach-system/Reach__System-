import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  QUOTATION_DATE_ONLY_RE,
  QUOTATION_NOTE_MAX_LENGTH,
} from './create-quotation.dto';

export class ReviseQuotationDto {
  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(QUOTATION_DATE_ONLY_RE, { message: 'validUntil must be YYYY-MM-DD' })
  validUntil?: string;

  @ApiPropertyOptional({ maxLength: QUOTATION_NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTATION_NOTE_MAX_LENGTH)
  notes?: string;
}
