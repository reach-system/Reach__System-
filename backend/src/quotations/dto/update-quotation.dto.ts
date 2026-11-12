import { PartialType } from '@nestjs/swagger';
import { CreateQuotationDto } from './create-quotation.dto';

/** PATCH is DRAFT-only; omitted fields keep their current value. */
export class UpdateQuotationDto extends PartialType(CreateQuotationDto) {}
