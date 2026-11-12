import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { QuotationStatus, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequestWithUser } from '../common/types/request-with-user.interface';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import { ReviseQuotationDto } from './dto/revise-quotation.dto';

function parseStatus(status?: string): QuotationStatus | undefined {
  if (!status) return undefined;
  if (!Object.values(QuotationStatus).includes(status as QuotationStatus)) {
    throw new BadRequestException({
      code: 'INVALID_STATUS',
      message: `Invalid status filter. Allowed: ${Object.values(QuotationStatus).join(', ')}`,
    });
  }
  return status as QuotationStatus;
}

@ApiTags('Quotations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private quotationsService: QuotationsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Create a draft quotation (Sales/Admin)' })
  async create(@Request() req: RequestWithUser, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(req.user, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'List quotations with server-side filters and pagination' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortDir', required: false })
  async findAll(
    @Request() req: RequestWithUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
  ) {
    return this.quotationsService.findAll({
      requester: req.user,
      search,
      status: parseStatus(status),
      customerId: customerId ? Number(customerId) : undefined,
      employeeId: employeeId ? Number(employeeId) : undefined,
      from,
      to,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      sortBy,
      sortDir,
    });
  }

  @Get('report/details')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Quotation report detail rows (Admin) — excludes soft-deleted rows' })
  async reportDetails(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('createdById') createdById?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('all') all?: string,
  ) {
    return this.quotationsService.getReportDetails({
      from,
      to,
      createdById: createdById ? Number(createdById) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      status: parseStatus(status),
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 25,
      all: all === '1' || all === 'true',
    });
  }

  @Get('report')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Quotation report summary (Admin)' })
  async report(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('createdById') createdById?: string,
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.quotationsService.getReport({
      from,
      to,
      createdById: createdById ? Number(createdById) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      status: parseStatus(status),
      search,
    });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Quotation details (items, timeline, revisions, converted invoice)' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Request() req: RequestWithUser) {
    return this.quotationsService.findOne(id, req.user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Edit a DRAFT quotation (owner or Admin)' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: RequestWithUser,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(id, req.user, dto);
  }

  @Patch(':id/send')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Mark a draft quotation as sent' })
  async send(@Param('id', ParseIntPipe) id: number, @Request() req: RequestWithUser) {
    return this.quotationsService.send(id, req.user);
  }

  @Patch(':id/accept')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Mark a sent quotation as accepted' })
  async accept(@Param('id', ParseIntPipe) id: number, @Request() req: RequestWithUser) {
    return this.quotationsService.accept(id, req.user);
  }

  @Patch(':id/reject')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Reject a sent quotation' })
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: RequestWithUser,
    @Body() dto: RejectQuotationDto,
  ) {
    return this.quotationsService.reject(id, req.user, dto.reason);
  }

  @Post(':id/revise')
  @Roles(Role.ADMIN, Role.SALES)
  @ApiOperation({ summary: 'Create a linked draft revision of a sent/rejected/expired quotation' })
  async revise(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: RequestWithUser,
    @Body() dto: ReviseQuotationDto,
  ) {
    return this.quotationsService.revise(id, req.user, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Soft-delete a quotation (Admin only, never a converted one)' })
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req: RequestWithUser) {
    return this.quotationsService.remove(id, req.user);
  }
}
