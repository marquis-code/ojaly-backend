import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { RiskEvent, RiskEventDocument } from './risk-event.schema';
import { normalizeNigerianPhone } from '../../common/utils/phone';

const DISPOSABLE = ['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'yopmail.com'];

@Injectable()
export class RiskService {
  constructor(
    @InjectModel(RiskEvent.name) private readonly events: Model<RiskEventDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  async assessBooking(input: { businessId: string; phone: string; email?: string | null; amountKobo: number; startAt: Date; serviceId: string; reference: string }) {
    const phone = normalizeNigerianPhone(input.phone) || input.phone;
    const since1h = new Date(Date.now() - 3600000);
    const since24h = new Date(Date.now() - 86400000);
    const [hourCount, dayCount, orderCount, duplicate] = await Promise.all([
      this.bookings.countDocuments({ customerPhone: phone, createdAt: { $gte: since1h } }).exec(),
      this.bookings.countDocuments({ customerPhone: phone, createdAt: { $gte: since24h } }).exec(),
      this.orders.countDocuments({ customerPhone: phone, createdAt: { $gte: since24h } }).exec(),
      this.bookings.countDocuments({ customerPhone: phone, serviceId: input.serviceId, startAt: input.startAt, status: { $ne: 'cancelled' } }).exec(),
    ]);
    const flags: string[] = [];
    let score = 0;
    if (duplicate > 0) { score += 60; flags.push('duplicate_slot'); }
    if (hourCount >= 6) { score += 40; flags.push('high_velocity_1h'); }
    else if (hourCount >= 3) { score += 15; flags.push('elevated_velocity_1h'); }
    if (dayCount >= 20) { score += 35; flags.push('high_velocity_24h'); }
    if (orderCount >= 10) { score += 20; flags.push('order_velocity_24h'); }
    const email = input.email?.toLowerCase().trim();
    if (email && DISPOSABLE.some((domain) => email.endsWith(`@${domain}`))) { score += 35; flags.push('disposable_email'); }
    if (input.amountKobo >= 50000000) { score += 10; flags.push('high_value_booking'); }
    const action = score >= 80 ? 'block' : score >= 25 ? 'review' : 'allow';
    if (score > 0) {
      await this.events.create({ businessId: input.businessId, kind: 'booking', reference: input.reference, customerPhone: phone, customerEmail: email || null, score, flags, action, metadata: { amountKobo: input.amountKobo, startAt: input.startAt } }).catch(() => undefined);
    }
    if (action === 'block') throw new ForbiddenException('We could not complete this booking automatically. Please contact the business directly or try again later.');
    return { score, flags, action };
  }

  async list(businessId?: string, limit = 100) {
    const filter = businessId ? { businessId } : {};
    return this.events.find(filter).sort({ createdAt: -1 }).limit(Math.min(300, limit)).lean().exec();
  }

  async stats() {
    const since = new Date(Date.now() - 7 * 86400000);
    const [total, blocked, review, recent] = await Promise.all([
      this.events.countDocuments({ createdAt: { $gte: since } }).exec(),
      this.events.countDocuments({ createdAt: { $gte: since }, action: 'block' }).exec(),
      this.events.countDocuments({ createdAt: { $gte: since }, action: 'review' }).exec(),
      this.events.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(15).lean().exec(),
    ]);
    return { total, blocked, review, recent };
  }
}
