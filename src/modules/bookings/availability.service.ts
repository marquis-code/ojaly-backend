import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { Booking, BookingDocument } from './booking.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { CalendarService } from '../calendar/calendar.service';
import {
  addMinutes, businessDefaultSchedule, isValidLocalDate, localDateKey, minutesFromTime,
  timeFromMinutes, timeOffContains, weekdayForDate, zonedDate,
} from './booking.utils';

interface SlotProvider {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    private readonly calendarSync: CalendarService,
  ) {}

  async forService(businessId: string, serviceId: string, date: string, providerId?: string, durationOverride?: number, options?: { ignoreWindow?: boolean }) {
    if (!isValidLocalDate(date)) throw new BadRequestException('Choose a valid date.');
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: serviceId, businessId, isActive: true, isPublic: true }).lean().exec(),
    ]);
    if (!business) throw new NotFoundException('Business not found.');
    if (!service) throw new NotFoundException('Service not found.');
    const settings = business.bookingSettings;
    if (!settings?.enabled) throw new BadRequestException('Online booking is not enabled for this business yet.');

    const timezone = business.timezone || 'Africa/Lagos';
    const now = new Date();
    const windowEnd = addMinutes(now, Math.max(1, settings.windowDays) * 1440);
    const dayStart = zonedDate(date, '00:00', timezone);
    const dayEnd = zonedDate(date, '23:59', timezone);
    if (dayEnd < now) return { date, timezone, slots: [], service: this.serviceView(service), closed: true, waitlistAllowed: Boolean(settings.waitlistOnClosedDays), full: false };
    if (!options?.ignoreWindow && dayStart > windowEnd) return { date, timezone, slots: [], service: this.serviceView(service), closed: false, waitlistAllowed: true, full: false };
    if ((settings.closedDates || []).includes(date)) return { date, timezone, slots: [], service: this.serviceView(service), closed: true, waitlistAllowed: Boolean(settings.waitlistOnClosedDays), full: false };

    const allProviders = await this.providers.find({
      businessId,
      isActive: true,
      isBookable: true,
      ...(providerId ? { _id: providerId } : service.providerIds?.length ? { _id: { $in: service.providerIds } } : {}),
    }).sort({ sortOrder: 1 }).lean().exec();
    if (!allProviders.length) {
      return { date, timezone, slots: [], service: this.serviceView(service), closed: true, waitlistAllowed: Boolean(settings.waitlistOnClosedDays), full: false };
    }

    const weekday = weekdayForDate(date, timezone);
    const defaultSchedule = businessDefaultSchedule(settings);
    const daySettings = (settings.weeklyHours || []).find((day) => day.day === weekday);
    const interval = Math.max(5, daySettings?.slotIntervalMinutes || settings.slotIntervalMinutes || 30);
    const effectiveServiceDuration = service.durationMinutes > 0 ? service.durationMinutes : interval;
    const minStart = Math.max(now.getTime() + (settings.leadTimeMinutes || 0) * 60000, dayStart.getTime());
    const duration = (durationOverride || effectiveServiceDuration) + (service.bufferBeforeMinutes || 0) + (service.bufferAfterMinutes || 0);

    const nowMs = now.getTime();
    const rawExisting = await this.bookings.find({
      businessId,
      providerId: { $in: allProviders.map((p) => String(p._id)) },
      status: { $in: ['pending', 'confirmed'] },
      blockStartAt: { $lt: dayEnd },
      blockEndAt: { $gt: dayStart },
    }).lean().exec();
    const existing: Array<{ providerId: string; blockStartAt: Date; blockEndAt: Date }> = rawExisting.filter((b) => {
      if (b.status === 'pending' && b.paymentStatus === 'unpaid' && ['storefront', 'marketplace'].includes(b.source)) {
        if (b.paymentExpiresAt && new Date(b.paymentExpiresAt).getTime() < nowMs) return false;
        if (!b.paymentExpiresAt && (b.createdAt ? new Date(b.createdAt).getTime() + 15 * 60 * 1000 < nowMs : false)) return false;
      }
      return true;
    }).map((b) => ({ providerId: String(b.providerId), blockStartAt: new Date(b.blockStartAt), blockEndAt: new Date(b.blockEndAt) }));

    const pendingCheckouts = await this.payments.find({
      businessId,
      purpose: 'booking',
      status: 'pending',
      createdAt: { $gt: new Date(nowMs - 15 * 60 * 1000) },
    }).lean().exec();

    for (const checkout of pendingCheckouts) {
      const draft = (checkout.metadata as Record<string, any>)?.bookingDraft;
      if (!draft?.providerId || !draft?.startAt) continue;
      const draftStartAt = new Date(draft.startAt);
      const draftDuration = Number(draft.durationMinutes || effectiveServiceDuration);
      const draftBlockStart = addMinutes(draftStartAt, -(service.bufferBeforeMinutes || 0));
      const draftBlockEnd = addMinutes(addMinutes(draftStartAt, draftDuration), service.bufferAfterMinutes || 0);
      if (draftBlockStart < dayEnd && draftBlockEnd > dayStart) {
        existing.push({
          providerId: String(draft.providerId),
          blockStartAt: draftBlockStart,
          blockEndAt: draftBlockEnd,
        });
      }
    }

    const dayCapacity = Math.max(0, Number(daySettings?.maxSlots || 0));
    if (dayCapacity > 0) {
      const dayBookings = await this.bookings.countDocuments({ businessId, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: dayStart, $lte: dayEnd } }).exec();
      if (dayBookings >= dayCapacity) return { date, timezone, slots: [], service: this.serviceView(service), closed: false, waitlistAllowed: true, full: true };
    }

    const externalBusy = await this.calendarSync.busyForDay(businessId, dayStart, dayEnd).catch(() => []);
    const slots = new Map<string, { startAt: string; endAt: string; time: string; providers: SlotProvider[] }>();
    for (const provider of allProviders) {
      const scheduled = (provider.weeklySchedule?.length ? provider.weeklySchedule : defaultSchedule)
        .find((d) => d.day === weekday);
      if (!scheduled?.isWorking) continue;
      const schedule = scheduled as { start: string; end: string; breaks?: { start: string; end: string }[] };
      const open = minutesFromTime(schedule.start);
      const close = minutesFromTime(schedule.end);
      if (close <= open || close - open < duration) continue;

      for (let cursor = open; cursor + duration <= close; cursor += interval) {
        const startAt = zonedDate(date, timeFromMinutes(cursor), timezone);
        if (startAt.getTime() < minStart) continue;
        const blockStartAt = addMinutes(startAt, -(service.bufferBeforeMinutes || 0));
        const blockEndAt = addMinutes(addMinutes(startAt, effectiveServiceDuration), service.bufferAfterMinutes || 0);
        if (blockEndAt > dayEnd) continue;

        if (schedule.breaks?.some((b) => cursor < minutesFromTime(b.end) && cursor + duration > minutesFromTime(b.start))) continue;
        if (timeOffContains(blockStartAt, blockEndAt, provider.timeOff || [])) continue;
        if (externalBusy.some((busy) => new Date(busy.startAt) < blockEndAt && new Date(busy.endAt) > blockStartAt)) continue;

        const conflicts = existing.filter((b) =>
          String(b.providerId) === String(provider._id) &&
          new Date(b.blockStartAt) < blockEndAt &&
          new Date(b.blockEndAt) > blockStartAt,
        );
        if (conflicts.length >= Math.max(1, service.maxBookingsPerSlot || 1)) continue;

        const key = startAt.toISOString();
        const current = slots.get(key);
        const slotProvider: SlotProvider = {
          id: String(provider._id),
          name: provider.name,
          avatarUrl: provider.avatarUrl,
          color: provider.color,
        };
        if (current) current.providers.push(slotProvider);
        else slots.set(key, {
          startAt: key,
          endAt: addMinutes(startAt, durationOverride || effectiveServiceDuration).toISOString(),
          time: timeFromMinutes(cursor),
          providers: [slotProvider],
        });
      }
    }

    return {
      date,
      timezone,
      service: this.serviceView(service),
      closed: false,
      slots: [...slots.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    };
  }

  async assertSlot(businessId: string, serviceId: string, startAt: Date, providerId: string, timezone: string, durationOverride?: number, options?: { ignoreWindow?: boolean }) {
    const date = localDateKey(startAt, timezone);
    const result = await this.forService(businessId, serviceId, date, providerId, durationOverride, options);
    const match = result.slots.find((s) => Math.abs(new Date(s.startAt).getTime() - startAt.getTime()) < 60000);
    if (!match) throw new BadRequestException('That time is no longer available. Please choose another slot.');
    return match;
  }

  private serviceView(service: ServiceDocument | (Service & { _id: unknown })) {
    const s = service as ServiceDocument;
    return {
      id: String(s._id), name: s.name, durationMinutes: s.durationMinutes,
      priceKobo: s.priceKobo, bufferBeforeMinutes: s.bufferBeforeMinutes,
      bufferAfterMinutes: s.bufferAfterMinutes, maxBookingsPerSlot: s.maxBookingsPerSlot,
    };
  }
}
