import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { RealtimeController } from './realtime.controller';
import { RealtimeEvent, RealtimeService } from './realtime.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RealtimeController event authorization audit', () => {
  it('[EXPECTED FAIL] does not deliver an event to a user outside its role/employee scope', async () => {
    const request = Object.assign(new EventEmitter(), {
      headers: { authorization: 'Bearer test-token' },
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
    };
    let subscriber: ((event: RealtimeEvent) => void) | undefined;
    const realtimeService = {
      subscribe: jest.fn((callback: (event: RealtimeEvent) => void) => {
        subscriber = callback;
        return jest.fn();
      }),
    };
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue({
          id: 21,
          role: Role.SALES,
          isActive: true,
          deletedAt: null,
        }),
      },
    };
    const jwtService = { verifyAsync: jest.fn().mockResolvedValue({ sub: 21 }) };
    const controller = new RealtimeController(
      realtimeService as unknown as RealtimeService,
      prisma as unknown as PrismaService,
      jwtService as never,
      { get: jest.fn().mockReturnValue('test-secret') } as never,
    );

    await controller.events(request as unknown as Request, response as unknown as Response);
    subscriber?.({
      type: 'audit.sensitive',
      roles: [Role.ADMIN],
      payload: { invoiceTotal: 1250 },
      timestamp: new Date().toISOString(),
    });
    request.emit('close');

    expect(response.write).toHaveBeenCalledTimes(1);
  });
});
