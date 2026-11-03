import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { PaystackService } from '../payments/paystack.service';
import { PayrollItem, PayrollRun, PayrollRunDocument } from './payroll.schema';

@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(PayrollRun.name) private readonly runs: Model<PayrollRunDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    private readonly paystack: PaystackService,
  ) {}

  async list(businessId: string) {
    const runs = await this.runs.find({ businessId }).sort({ period: -1 }).limit(36).lean().exec();
    return runs.map((run) => this.view(run));
  }

  async get(businessId: string, id: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).lean().exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    return this.view(run);
  }

  async generate(businessId: string, period: string, userId: string) {
    const existing = await this.runs.findOne({ businessId, period, status: { $ne: 'cancelled' } }).lean().exec();
    if (existing) throw new ConflictException(`A payroll run for ${period} already exists.`);
    const start = this.periodStart(period);
    const end = this.periodEnd(period);
    const providers = await this.providers.find({ businessId, isActive: true, salaryEnabled: true, monthlySalaryKobo: { $gt: 0 } }).lean().exec();
    if (!providers.length) throw new BadRequestException('No team members have a salary enabled yet.');
    const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86400000);
    const bookings = await this.bookings.find({
      businessId, providerId: { $in: providers.map((p) => String(p._id)) },
      startAt: { $gte: start, $lt: end },
    }).select('providerId status').lean().exec();
    const items = providers.map((provider): PayrollItem | null => {
      const own = bookings.filter((b) => b.providerId === String(provider._id));
      const completedJobs = own.filter((b) => b.status === 'completed').length;
      const assignedJobs = own.length;
      const startDate = provider.salaryStartDate ? new Date(`${provider.salaryStartDate}T00:00:00+01:00`) : null;
      if (startDate && startDate.getTime() >= end.getTime()) return null;
      const activeDays = startDate && startDate.getTime() > start.getTime() ? Math.max(0, Math.ceil((end.getTime() - startDate.getTime()) / 86400000)) : daysInMonth;
      const salary = Math.round(((provider.monthlySalaryKobo || 0) * activeDays) / Math.max(1, daysInMonth));
      return {
        providerId: String(provider._id), providerName: provider.name,
        monthlySalaryKobo: salary, completedJobs, assignedJobs,
        completionRate: assignedJobs ? Math.round((completedJobs / assignedJobs) * 100) : 0,
        adjustmentKobo: 0, deductionKobo: 0, note: '', netKobo: salary,
        status: 'pending', transferReference: null, transferCode: null, paidAt: null, failureReason: null,
      };
    }).filter((item): item is PayrollItem => item !== null);
    if (!items.length) throw new BadRequestException('No salaried team members are active in this period.');
    const run = await this.runs.create({
      businessId, period, status: 'draft', items, createdBy: userId,
      totalKobo: items.reduce((sum, item) => sum + item.netKobo, 0),
    });
    return this.view(run);
  }

  async updateItem(businessId: string, id: string, providerId: string, dto: { adjustmentKobo?: number; deductionKobo?: number; note?: string }) {
    const run = await this.runs.findOne({ _id: id, businessId }).exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    if (!['draft', 'approved'].includes(run.status)) throw new BadRequestException('Only draft or approved payroll can be edited.');
    const item = run.items.find((entry) => entry.providerId === providerId);
    if (!item) throw new NotFoundException('Team member is not in this payroll run.');
    if (dto.adjustmentKobo !== undefined) item.adjustmentKobo = Math.max(0, dto.adjustmentKobo);
    if (dto.deductionKobo !== undefined) item.deductionKobo = Math.max(0, dto.deductionKobo);
    if (dto.note !== undefined) item.note = String(dto.note || '').slice(0, 500);
    item.netKobo = Math.max(0, item.monthlySalaryKobo + item.adjustmentKobo - item.deductionKobo);
    run.totalKobo = run.items.reduce((sum, entry) => sum + entry.netKobo, 0);
    await run.save();
    return this.view(run);
  }

  async approve(businessId: string, id: string, userId: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    if (run.status !== 'draft') throw new BadRequestException('Only a draft payroll can be approved.');
    if (!run.items.length) throw new BadRequestException('This payroll has no team members.');
    run.status = 'approved';
    run.approvedBy = userId;
    run.approvedAt = new Date();
    await run.save();
    return this.view(run);
  }

  async pay(businessId: string, id: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    if (!['approved', 'partially_paid', 'processing'].includes(run.status)) throw new BadRequestException('Approve this payroll before paying it.');
    for (const item of run.items) {
      if (item.status === 'paid') continue;
      if (item.status === 'processing') {
        if (item.transferReference) {
          const verified = await this.paystack.verifyTransfer(item.transferReference).catch(() => null);
          if (verified?.status === 'success') { item.status = 'paid'; item.paidAt = new Date(); item.failureReason = null; }
        }
        continue;
      }
      if (item.netKobo < 100) { item.status = 'failed'; item.failureReason = 'Salary is below Paystack’s minimum transfer amount.'; continue; }
      const provider = await this.providers.findOne({ _id: item.providerId, businessId }).exec();
      if (!provider) { item.status = 'failed'; item.failureReason = 'Team member no longer exists.'; continue; }
      if (!provider.bankCode || !provider.accountNumber) { item.status = 'failed'; item.failureReason = 'Add the team member’s bank name, bank code and account number.'; continue; }
      try {
        if (!provider.paystackRecipientCode) {
          const recipient = await this.paystack.createTransferRecipient({
            name: provider.accountName || provider.name,
            accountNumber: provider.accountNumber,
            bankCode: provider.bankCode,
          });
          provider.paystackRecipientCode = recipient.recipientCode;
          await provider.save();
        }
        const reference = item.transferReference || `salary_${String(run._id)}_${item.providerId}`;
        const transfer = await this.paystack.initiateTransfer({
          amountKobo: item.netKobo,
          recipient: provider.paystackRecipientCode,
          reason: `Salary ${run.period} — ${provider.name}`,
          reference,
        });
        item.transferReference = transfer.reference;
        item.transferCode = transfer.transferCode;
        item.status = transfer.status === 'success' ? 'paid' : 'processing';
        item.paidAt = transfer.status === 'success' ? new Date() : null;
        item.failureReason = null;
      } catch (error) {
        item.status = 'failed';
        item.failureReason = (error as Error).message.slice(0, 500);
      }
    }
    this.finish(run);
    await run.save();
    return this.view(run);
  }

  async verify(businessId: string, id: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    for (const item of run.items) {
      if (item.status !== 'processing' || !item.transferReference) continue;
      const verified = await this.paystack.verifyTransfer(item.transferReference).catch(() => null);
      if (!verified) continue;
      item.transferCode = verified.transferCode || item.transferCode;
      if (verified.status === 'success') { item.status = 'paid'; item.paidAt = new Date(); item.failureReason = null; }
      else if (verified.status === 'failed' || verified.status === 'reversed') { item.status = 'failed'; item.failureReason = 'Paystack reported this transfer as failed.'; }
    }
    this.finish(run);
    await run.save();
    return this.view(run);
  }

  async cancel(businessId: string, id: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    if (run.status !== 'draft') throw new BadRequestException('Only a draft payroll can be cancelled.');
    run.status = 'cancelled';
    await run.save();
    return this.view(run);
  }

  private finish(run: PayrollRunDocument) {
    const paid = run.items.every((item) => item.status === 'paid');
    const anyPaid = run.items.some((item) => item.status === 'paid');
    const anyProcessing = run.items.some((item) => item.status === 'processing');
    if (paid) { run.status = 'paid'; run.paidAt = new Date(); }
    else if (anyProcessing || anyPaid) run.status = anyPaid ? 'partially_paid' : 'processing';
    else run.status = 'approved';
  }

  private view(run: PayrollRun | (PayrollRun & { _id: unknown })) {
    return {
      id: String((run as { _id: unknown })._id), period: run.period, status: run.status,
      items: run.items, totalKobo: run.totalKobo, createdBy: run.createdBy,
      approvedBy: run.approvedBy, approvedAt: run.approvedAt, paidAt: run.paidAt,
      createdAt: (run as { createdAt?: Date }).createdAt,
    };
  }

  private periodStart(period: string) { return new Date(`${period}-01T00:00:00+01:00`); }
  private periodEnd(period: string) {
    const [year, month] = period.split('-').map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    return new Date(`${next}-01T00:00:00+01:00`);
  }
}
