import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { businessDefaultSchedule } from '../bookings/booking.utils';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Provider, ProviderDocument, ProviderDay } from './provider.schema';
import { CreateProviderDto, UpdateProviderDto } from './provider.dto';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
  ) {}

  async list(businessId: string) {
    const providers = await this.providers.find({ businessId }).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    const counts = await this.bookings.aggregate([
      { $match: { businessId, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: new Date() } } },
      { $group: { _id: '$providerId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
    const [completed, assigned] = await Promise.all([
      this.bookings.aggregate([{ $match: { businessId, status: 'completed' } }, { $group: { _id: '$providerId', count: { $sum: 1 } } }]),
      this.bookings.aggregate([{ $match: { businessId, status: { $in: ['pending', 'confirmed', 'completed'] } } }, { $group: { _id: '$providerId', count: { $sum: 1 } } }]),
    ]);
    const completedMap = new Map(completed.map((c) => [String(c._id), c.count]));
    const assignedMap = new Map(assigned.map((c) => [String(c._id), c.count]));
    return providers.map((p) => {
      const done = completedMap.get(String(p._id)) || 0;
      const total = assignedMap.get(String(p._id)) || 0;
      return { ...this.view(p), upcomingBookings: countMap.get(String(p._id)) || 0, completedBookings: done, assignedBookings: total, completionRate: total ? Math.round((done / total) * 100) : 0 };
    });
  }

  async publicList(businessId: string) {
    const providers = await this.providers.find({ businessId, isActive: true, isBookable: true }).sort({ sortOrder: 1, createdAt: 1 }).lean().exec();
    return providers.map((p) => ({
      id: String(p._id), name: p.name, title: p.title, bio: p.bio, avatarUrl: p.avatarUrl, color: p.color,
    }));
  }

  async create(businessId: string, dto: CreateProviderDto) {
    const provider = await this.providers.create({
      businessId,
      name: dto.name,
      title: dto.title || '',
      bio: dto.bio || '',
      email: dto.email || null,
      phone: dto.phone || null,
      avatarUrl: dto.avatarUrl || null,
      color: dto.color || '#FF5A1F',
      weeklySchedule: this.cleanSchedule(dto.weeklySchedule),
      timeOff: this.cleanTimeOff(dto.timeOff),
      isBookable: dto.isBookable ?? true,
      sortOrder: dto.sortOrder ?? 0,
      salaryEnabled: dto.salaryEnabled ?? false,
      payFrequency: dto.payFrequency || 'monthly',
      payRateKobo: dto.payRateKobo ?? dto.monthlySalaryKobo ?? 0,
      monthlySalaryKobo: (dto.payFrequency || 'monthly') === 'monthly' ? (dto.payRateKobo ?? dto.monthlySalaryKobo ?? 0) : 0,
      salaryStartDate: dto.salaryStartDate || null,
      bankName: dto.bankName || null,
      bankCode: dto.bankCode || null,
      accountNumber: dto.accountNumber || null,
      accountName: dto.accountName || null,
    });
    return this.view(provider);
  }

  async update(businessId: string, id: string, dto: UpdateProviderDto) {
    const provider = await this.providers.findOne({ _id: id, businessId }).exec();
    if (!provider) throw new NotFoundException('Team member not found.');
    if (dto.name !== undefined) provider.name = dto.name;
    if (dto.title !== undefined) provider.title = dto.title;
    if (dto.bio !== undefined) provider.bio = dto.bio;
    if (dto.email !== undefined) provider.email = dto.email || null;
    if (dto.phone !== undefined) provider.phone = dto.phone || null;
    if (dto.avatarUrl !== undefined) provider.avatarUrl = dto.avatarUrl || null;
    if (dto.color !== undefined) provider.color = dto.color;
    if (dto.weeklySchedule !== undefined) provider.weeklySchedule = this.cleanSchedule(dto.weeklySchedule);
    if (dto.timeOff !== undefined) provider.timeOff = this.cleanTimeOff(dto.timeOff);
    if (dto.isBookable !== undefined) provider.isBookable = dto.isBookable;
    if (dto.isActive !== undefined) provider.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) provider.sortOrder = dto.sortOrder;
    if (dto.salaryEnabled !== undefined) provider.salaryEnabled = dto.salaryEnabled;
    if (dto.payFrequency !== undefined) provider.payFrequency = dto.payFrequency;
    if (dto.payRateKobo !== undefined) provider.payRateKobo = dto.payRateKobo;
    if (dto.monthlySalaryKobo !== undefined) provider.monthlySalaryKobo = dto.monthlySalaryKobo;
    if (dto.salaryStartDate !== undefined) provider.salaryStartDate = dto.salaryStartDate || null;
    if (dto.bankName !== undefined) provider.bankName = dto.bankName || null;
    if (dto.bankCode !== undefined) provider.bankCode = dto.bankCode || null;
    if (dto.accountNumber !== undefined) provider.accountNumber = dto.accountNumber || null;
    if (dto.accountName !== undefined) provider.accountName = dto.accountName || null;
    if (dto.bankCode !== undefined || dto.accountNumber !== undefined) provider.paystackRecipientCode = null;
    await provider.save();
    return this.view(provider);
  }

  async remove(businessId: string, id: string) {
    const provider = await this.providers.findOne({ _id: id, businessId }).exec();
    if (!provider) throw new NotFoundException('Team member not found.');
    provider.isActive = false;
    provider.isBookable = false;
    await provider.save();
    return { removed: true };
  }

  async ensureOwnerProvider(businessId: string): Promise<ProviderDocument> {
    const existing = await this.providers.findOne({ businessId, isActive: true }).exec();
    if (existing) return existing;
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const ownerMembership = await this.memberships.findOne({ businessId, role: 'owner' }).lean().exec();
    const user = ownerMembership ? await this.users.findById(ownerMembership.userId).lean().exec() : null;
    const schedule = businessDefaultSchedule(business.bookingSettings);
    return this.providers.create({
      businessId,
      name: user?.name || business.name,
      title: 'Owner',
      bio: '',
      email: user?.email || business.email || null,
      phone: user?.phone || business.publicPhone || null,
      avatarUrl: user?.avatarUrl || business.logoUrl || null,
      color: business.brandColor || '#FF5A1F',
      userId: user ? String(user._id) : null,
      membershipId: ownerMembership ? String(ownerMembership._id) : null,
      weeklySchedule: schedule,
      isBookable: true,
    });
  }

  private cleanSchedule(days?: { day: number; isWorking: boolean; start: string; end: string; breaks?: { start: string; end: string }[] }[]): ProviderDay[] {
    if (!days?.length) return [];
    return days.map((d) => ({
      day: d.day,
      isWorking: d.isWorking,
      start: d.start,
      end: d.end || '18:00',
      breaks: (d.breaks || []).filter((b) => b.start < b.end),
    }));
  }

  private cleanTimeOff(items?: { startAt: string; endAt: string; reason?: string }[]) {
    if (!items?.length) return [];
    return items.map((t) => {
      const startAt = new Date(t.startAt);
      const endAt = new Date(t.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
        throw new BadRequestException('Each time-off block needs a valid start and end.');
      }
      return { startAt, endAt, reason: t.reason || 'Time off' };
    });
  }

  private view(p: ProviderDocument | (Provider & { _id: unknown })) {
    const provider = p as ProviderDocument;
    return {
      id: String(provider._id),
      name: provider.name,
      title: provider.title,
      bio: provider.bio,
      email: provider.email,
      phone: provider.phone,
      avatarUrl: provider.avatarUrl,
      color: provider.color,
      weeklySchedule: provider.weeklySchedule || [],
      timeOff: provider.timeOff || [],
      isBookable: provider.isBookable,
      isActive: provider.isActive,
      sortOrder: provider.sortOrder,
      salaryEnabled: Boolean(provider.salaryEnabled),
      payFrequency: provider.payFrequency || 'monthly',
      payRateKobo: provider.payRateKobo || provider.monthlySalaryKobo || 0,
      monthlySalaryKobo: provider.payFrequency === 'monthly' ? (provider.payRateKobo || provider.monthlySalaryKobo || 0) : 0,
      salaryStartDate: provider.salaryStartDate || null,
      bankName: provider.bankName || null,
      accountName: provider.accountName || null,
      bankAccountLast4: provider.accountNumber ? provider.accountNumber.slice(-4) : null,
      hasBankDetails: Boolean(provider.bankCode && provider.accountNumber),
    };
  }
}
