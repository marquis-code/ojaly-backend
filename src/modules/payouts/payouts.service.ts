import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { WithdrawalRequest, WithdrawalDocument } from './withdrawal.schema';

@Injectable()
export class PayoutsService {
  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(WithdrawalRequest.name) private readonly withdrawals: Model<WithdrawalDocument>,
  ) {}

  async summary(businessId: string) {
    const [business, bookings, requests] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.bookings.find({ businessId, status: 'completed', paymentStatus: { $in: ['paid', 'deposit_paid'] } }).select('providerNetKobo amountPaidKobo bookingNumber completedAt').lean().exec(),
      this.withdrawals.find({ businessId }).sort({ createdAt: -1 }).limit(100).lean().exec(),
    ]);
    const earnedKobo = bookings.reduce((sum, booking) => sum + (booking.providerNetKobo || 0), 0);
    const reservedKobo = requests.filter((request) => ['pending', 'approved', 'paid'].includes(request.status)).reduce((sum, request) => sum + request.amountKobo, 0);
    const paidKobo = requests.filter((request) => request.status === 'paid').reduce((sum, request) => sum + request.amountKobo, 0);
    const pendingKobo = requests.filter((request) => ['pending', 'approved'].includes(request.status)).reduce((sum, request) => sum + request.amountKobo, 0);
    const account = business?.settlementAccounts?.find((item) => item.id === business.settlementPrimaryAccountId) || business?.settlementAccounts?.[0] || null;
    return {
      earnedKobo, availableKobo: Math.max(0, earnedKobo - reservedKobo), pendingKobo, paidKobo,
      completedBookings: bookings.length,
      settlementAccount: account,
      requests: requests.map((request) => this.view(request)),
    };
  }

  async request(businessId: string, userId: string, amountKobo: number, note = '') {
    if (amountKobo < 10000) throw new BadRequestException('Minimum withdrawal is ₦100.');
    const data = await this.summary(businessId);
    if (amountKobo > data.availableKobo) throw new BadRequestException('That amount is more than your available balance.');
    const account = data.settlementAccount;
    if (!account) throw new BadRequestException('Add a settlement bank account before requesting a withdrawal.');
    const request = await this.withdrawals.create({
      businessId, amountKobo, status: 'pending', bankName: account.bankName, bankCode: account.bankCode,
      accountNumber: account.accountNumber, accountName: account.accountName,
      note: note.slice(0, 500), requestedBy: userId,
    });
    return this.view(request);
  }

  async adminList() {
    const requests = await this.withdrawals.find({}).sort({ createdAt: -1 }).limit(200).lean().exec();
    const businesses = await this.businesses.find({ _id: { $in: requests.map((request) => request.businessId) } }).select('name slug').lean().exec();
    return requests.map((request) => ({ ...this.view(request), business: businesses.find((business) => String(business._id) === request.businessId) || null }));
  }

  async adminUpdate(actorId: string, id: string, status: 'approved' | 'paid' | 'rejected', adminNote = '', reference?: string) {
    const request = await this.withdrawals.findOneAndUpdate(
      { _id: id },
      { $set: { status, adminNote: adminNote.slice(0, 1000), reference: reference || null, processedBy: actorId, processedAt: new Date() } },
      { new: true },
    ).lean().exec();
    if (!request) throw new NotFoundException('Withdrawal request not found.');
    return this.view(request);
  }

  private view(request: WithdrawalRequest & { _id: unknown }) {
    return {
      id: String(request._id), businessId: request.businessId, amountKobo: request.amountKobo,
      status: request.status, bankName: request.bankName, accountNumber: request.accountNumber,
      accountName: request.accountName, note: request.note, adminNote: request.adminNote,
      reference: request.reference, createdAt: (request as { createdAt?: Date }).createdAt,
      processedAt: request.processedAt,
    };
  }
}
