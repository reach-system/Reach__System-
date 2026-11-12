import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { QuotationsService } from './quotations.service';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const FIRST_SWEEP_DELAY_MS = 15 * 1000;

/**
 * Lightweight expiry sweep.
 *
 * The project does not depend on @nestjs/schedule, so this uses one unref'd
 * interval instead of adding a scheduling framework. Reads additionally
 * compute the effective status, and send/accept/convert re-check validity, so
 * a delayed sweep can never let an expired quote be accepted or converted.
 */
@Injectable()
export class QuotationExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotationExpiryService.name);
  private interval?: NodeJS.Timeout;
  private firstSweep?: NodeJS.Timeout;
  private running = false;

  constructor(private quotationsService: QuotationsService) {}

  onModuleInit() {
    this.firstSweep = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.firstSweep.unref?.();

    this.interval = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.interval.unref?.();
  }

  onModuleDestroy() {
    if (this.firstSweep) clearTimeout(this.firstSweep);
    if (this.interval) clearInterval(this.interval);
  }

  private async sweep() {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.quotationsService.expireOverdueQuotations();
      if (expired > 0) {
        this.logger.log(`Expired ${expired} quotation(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Quotation expiry sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
