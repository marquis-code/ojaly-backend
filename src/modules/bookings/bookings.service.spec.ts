import { BookingsService } from './bookings.service';

describe('BookingsService - payment enforcement and lifecycle', () => {
  const createMockService = (overrides: Record<string, unknown> = {}) => {
    const defaultMocks: any[] = Array(23).fill(null).map(() => ({} as never));
    if (overrides.bookings) defaultMocks[0] = overrides.bookings;
    if (overrides.businesses) defaultMocks[3] = overrides.businesses;
    if (overrides.customers) defaultMocks[4] = overrides.customers;
    if (overrides.notifications) defaultMocks[13] = overrides.notifications;
    if (overrides.calendarSync) defaultMocks[21] = overrides.calendarSync;
    return new BookingsService(
      defaultMocks[0], defaultMocks[1], defaultMocks[2], defaultMocks[3],
      defaultMocks[4], defaultMocks[5], defaultMocks[6], defaultMocks[7],
      defaultMocks[8], defaultMocks[9], defaultMocks[10], defaultMocks[11],
      defaultMocks[12], defaultMocks[13], defaultMocks[14], defaultMocks[15],
      defaultMocks[16], defaultMocks[17], defaultMocks[18], defaultMocks[19],
      defaultMocks[20], defaultMocks[21], defaultMocks[22],
    );
  };

  it('requires deposit or full payment for storefront bookings and does not auto-confirm without payment', async () => {
    const mockBookingsModel = {
      findById: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    };
    const mockCustomers = {
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
    };
    const mockBusinesses = {
      findById: jest.fn(),
    };
    const mockNotifications = {
      create: jest.fn().mockResolvedValue({}),
    };
    const mockCalendarSync = {
      pushBooking: jest.fn().mockResolvedValue({}),
    };

    const service = createMockService({
      bookings: mockBookingsModel,
      businesses: mockBusinesses,
      customers: mockCustomers,
      notifications: mockNotifications,
      calendarSync: mockCalendarSync,
    });

    const bookingDoc = {
      _id: 'bkg-1',
      bookingNumber: 'BKG-001',
      publicToken: 'tok-123',
      serviceName: 'Knotless Braids',
      providerName: 'Sarah',
      customerName: 'Ada Nwosu',
      priceKobo: 2500000,
      depositKobo: 500000,
      amountPaidKobo: 0,
      status: 'pending',
      paymentStatus: 'unpaid',
      startAt: new Date('2026-11-25T10:00:00.000Z'),
      timezone: 'Africa/Lagos',
      paymentExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      history: [],
      save: jest.fn().mockResolvedValue(true),
    };
    mockBookingsModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(bookingDoc) });
    mockBusinesses.findById.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ name: 'The Glow Room', slug: 'glow-room' }),
      }),
    });

    const confirmed = await service.recordPayment('bkg-1', 500000, 'ref-paystack-1');
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.paymentStatus).toBe('deposit_paid');
    expect(confirmed.amountPaidKobo).toBe(500000);
    expect(confirmed.paymentReference).toBe('ref-paystack-1');
    expect(confirmed.paymentExpiresAt).toBeNull();
    expect(bookingDoc.save).toHaveBeenCalled();
    expect(mockNotifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('Payment received'),
      }),
    );
    expect(mockCalendarSync.pushBooking).toHaveBeenCalledWith(bookingDoc);
  });

  it('cancels unpaid pending bookings when requested', async () => {
    const mockBookingsModel = {
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) }),
    };

    const service = createMockService({
      bookings: mockBookingsModel,
    });

    await service.cancelUnpaidBooking('bkg-1', 'Payment gateway error');
    expect(mockBookingsModel.updateOne).toHaveBeenCalledWith(
      { _id: 'bkg-1', paymentStatus: 'unpaid', status: 'pending' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'cancelled',
          cancellationReason: 'Payment gateway error',
        }),
      }),
    );
  });

  it('quotes full price when service has price > 0 even if business depositPercent is 0 and requiresDeposit is false', async () => {
    const mockBusinesses = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'biz-1',
            timezone: 'Africa/Lagos',
            bookingSettings: { enabled: true, depositPercent: 0, paymentCollection: 'deposit' },
            serviceChargeEnabled: true,
            serviceChargeType: 'fixed',
            serviceChargeFixedKobo: 15000,
          }),
        }),
      }),
    };
    const mockServices = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: 'svc-1',
            name: 'Basic Single Bunk Steaming',
            priceKobo: 500000,
            durationMinutes: 30,
            requiresDeposit: false,
            addOns: [],
          }),
        }),
      }),
    };
    const mockProviders = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              _id: 'prov-1',
              name: 'Ayotomiwa Oshinowo',
            }),
          }),
        }),
      }),
    };
    const mockAvailability = {
      assertSlot: jest.fn().mockResolvedValue(true),
    };
    const mockPromotions = {
      platformDiscount: jest.fn().mockResolvedValue(null),
      newCustomerDiscount: jest.fn().mockResolvedValue(null),
    };

    const service = createMockService({
      businesses: mockBusinesses,
    });
    (service as any).services = mockServices;
    (service as any).providers = mockProviders;
    (service as any).availability = mockAvailability;
    (service as any).promotions = mockPromotions;

    const quote = await service.quotePublic('biz-1', {
      serviceId: 'svc-1',
      providerId: 'prov-1',
      startAt: '2026-11-27T10:00:00.000Z',
      customerName: 'Marquis Canon',
      customerPhone: '09012345678',
      customerEmail: 'abahmarquis@gmail.com',
      notes: 'Test',
      location: '',
      addOnNames: [],
    });

    expect(quote.subtotalKobo).toBe(500000);
    expect(quote.serviceChargeKobo).toBe(15000);
    expect(quote.totalKobo).toBe(515000);
    expect(quote.requiredKobo).toBe(515000);
    expect(quote.depositKobo).toBe(515000);
  });
});
