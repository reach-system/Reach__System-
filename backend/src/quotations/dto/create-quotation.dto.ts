import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const QUOTATION_NOTE_MAX_LENGTH = 1000;
export const QUOTATION_REJECT_REASON_MAX_LENGTH = 500;
export const QUOTATION_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class QuotationItemDto {
  @ApiProperty({ example: 11 })
  @IsInt()
  @Min(1)
  productModelId: number;

  @ApiProperty({ example: 2, description: 'Whole number for pieces, up to 2 decimals for meters' })
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 25, description: 'Absolute amount discounted on this line' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  lineDiscount?: number;
}

export class CreateQuotationDto {
  @ApiProperty({ example: 15 })
  @IsInt()
  @Min(1)
  customerId: number;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Last business day the quotation is valid (Africa/Cairo). Defaults to 14 days.',
  })
  @IsOptional()
  @IsString()
  @Matches(QUOTATION_DATE_ONLY_RE, { message: 'validUntil must be YYYY-MM-DD' })
  validUntil?: string;

  @ApiPropertyOptional({ example: 'Delivery within 7 days', maxLength: QUOTATION_NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTATION_NOTE_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercentage?: number;

  @ApiPropertyOptional({ example: 100, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @ApiProperty({
    example: [
      { productModelId: 11, quantity: 2, price: 500, lineDiscount: 0 },
      { productModelId: 12, quantity: 1, price: 12500, lineDiscount: 500 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemDto)
  items: QuotationItemDto[];
}
