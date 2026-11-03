import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { PaystackService } from '../payments/paystack.service';
import { PayrollFrequency, PayrollItem, PayrollRun, PayrollRunDocument } from './payroll.schema';

const DAY = 86400000;
const LAGOS = 'Africa/Lagos';

@Injectable()
export class PayrollService {
  constructor(
    @InjectModel(PayrollRun.name) private readonly runs: Model<PayrollRunDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    private readonly paystack: PaystackService,
  ) {}

  async list(businessId: string) {
    const runs = await this.runs.find({ businessId }).sort({ periodStart: -1 }).limit(60).lean().exec();
    return runs.map((run) => this.view(run));
  }

  async get(businessId: string, id: string) {
    const run = await this.runs.findOne({ _id: id, businessId }).lean().exec();
    if (!run) throw new NotFoundException('Payroll run not found.');
    return this.view(run);
  }

  async generate(businessId: string, frequency: PayrollFrequency, periodInput: string, userId: string) {
    const period = this.range(frequency, periodInput);
    const existing = await this.runs.findOne({ businessId, frequency, period: period.key, status: { $ne: 'cancelled' } }).lean().exec();
    if (existing) throw new ConflictException(`A ${frequency.replace('_', ' ')} payroll run for this period already exists.`);
    const providerFilter = frequency === 'monthly'
      ? { $or: [{ payFrequency: 'monthly' }, { payFrequency: { $exists: false } }] }
      : { payFrequency: frequency };
    const providers = await this.providers.find({ businessId, isActive: true, salaryEnabled: true, ...providerFilter }).lean().exec();
    if (!providers.length) throw new BadRequestException(`No active team members are set to ${frequency.replace('_', ' ')} pay.`);
    const ids = providers.map((p) => String(p._id));
    const bookings = await this.bookings.find({ businessId, providerId: { $in: ids }, startAt: { $gte: period.start, $lt: period.end } }).select('providerId status').lean().exec();
    const totalDays = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / DAY));
    const items = providers.map((provider): PayrollItem | null => {
      const startDate = provider.salaryStartDate ? new Date(`${provider.salaryStartDate}T00:00:00+01:00`) : null;
      if (startDate && startDate.getTime() >= period.end.getTime()) return null;
      const own = bookings.filter((b) => b.providerId === String(provider._id));
      const completedJobs = own.filter((b) => b.status === 'completed').length;
      const assignedJobs = own.length;
      const rate = provider.payRateKobo || provider.monthlySalaryKobo || 0;
      let units = 1;
      let gross = rate;
      if (frequency === 'per_service') {
        units = completedJobs;
        gross = rate * units;
      } else {
        const lateStart = startDate && startDate.getTime() > period.start.getTime();
        if (frequency === 'daily' && lateStart) return null;
        if (frequency !== 'daily' && lateStart) {
          const activeDays = Math.max(0, Math.ceil((period.end.getTime() - startDate!.getTime()) / DAY));
          gross = Math.round((rate * activeDays) / totalDays);
        }
      }
      return {
        providerId: String(provider._id), providerName: provider.name,
        monthlySalaryKobo: rate, payFrequency: frequency, payRateKobo: rate, units,
        grossKobo: gross, completedJobs, assignedJobs,
        completionRate: assignedJobs ? Math.round((completedJobs / assignedJobs) * 100) : 0,
        adjustmentKobo: 0, deductionKobo: 0, note: '', netKobo: gross,
        status: 'pending', transferReference: null, transferCode: null, paidAt: null, failureReason: null,
      };
    }).filter((item): item is PayrollItem => item !== null);
    if (!items.length) throw new BadRequestException('No salaried team members are active in this period.');
    const run = await this.runs.create({
      businessId, period: period.key, frequency, periodStart: period.start, periodEnd: period.end,
      status: 'draft', items, createdBy: userId, totalKobo: items.reduce((sum, item) => sum + item.netKobo, 0),
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
    item.netKobo = Math.max(0, item.grossKobo + item.adjustmentKobo - item.deductionKobo);
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
      if (item.netKobo < 100) { item.status = 'failed'; item.failureReason = 'Pay is below Paystack’s minimum transfer amount.'; continue; }
      const provider = await this.providers.findOne({ _id: item.providerId, businessId }).exec();
      if (!provider) { item.status = 'failed'; item.failureReason = 'Team member no longer exists.'; continue; }
      if (!provider.bankCode || !provider.accountNumber) { item.status = 'failed'; item.failureReason = 'Add the team member’s bank name, bank code and account number.'; continue; }
      try {
        if (!provider.paystackRecipientCode) {
          const recipient = await this.paystack.createTransferRecipient({ name: provider.accountName || provider.name, accountNumber: provider.accountNumber, bankCode: provider.bankCode });
          provider.paystackRecipientCode = recipient.recipientCode;
          await provider.save();
        }
        const reference = item.transferReference || `salary_${String(run._id)}_${item.providerId}`;
        const transfer = await this.paystack.initiateTransfer({
          amountKobo: item.netKobo, recipient: provider.paystackRecipientCode,
          reason: `Pay ${run.frequency.replace('_', ' ')} ${run.period} — ${provider.name}`, reference,
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

  @Cron('20 0 * * *', { timeZone: LAGOS, name: 'payroll-daily-automation' })
  async automateDaily() { await this.autoGenerate('daily'); }

  @Cron('25 0 * * 1', { timeZone: LAGOS, name: 'payroll-weekly-automation' })
  async automateWeekly() { await this.autoGenerate('weekly'); }

  @Cron('30 0 1 * *', { timeZone: LAGOS, name: 'payroll-monthly-automation' })
  async automateMonthly() { await Promise.all([this.autoGenerate('monthly'), this.autoGenerate('per_service')]); }

  private async autoGenerate(frequency: PayrollFrequency) {
    const date = this.previousPeriodDate(frequency);
    const providerFilter = frequency === 'monthly'
      ? { $or: [{ payFrequency: 'monthly' }, { payFrequency: { $exists: false } }] }
      : { payFrequency: frequency };
    const businesses = await this.providers.distinct('businessId', { salaryEnabled: true, isActive: true, ...providerFilter });
    for (const businessId of businesses) {
      await this.generate(businessId, frequency, date, 'system:automation').catch(() => undefined);
    }
  }

  private previousPeriodDate(frequency: PayrollFrequency): string {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const local = new Date(`${today}T12:00:00+01:00`);
    if (frequency === 'daily' || frequency === 'weekly') {
      local.setDate(local.getDate() - 1);
      return new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(local);
    }
    local.setDate(1);
    local.setMonth(local.getMonth() - 1);
    return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`;
  }

  private range(frequency: PayrollFrequency, input: string) {
    if (frequency === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new BadRequestException('Choose a valid day.');
      const start = new Date(`${input}T00:00:00+01:00`);
      return { key: input, start, end: new Date(start.getTime() + DAY) };
    }
    if (frequency === 'weekly') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) throw new BadRequestException('Choose a day inside the week.');
      const seed = new Date(`${input}T12:00:00+01:00`);
      const day = seed.getDay();
      const monday = new Date(seed); monday.setDate(seed.getDate() - ((day + 6) % 7)); monday.setHours(0, 0, 0, 0);
      const start = new Date(`${monday.toISOString().slice(0, 10)}T00:00:00+01:00`);
      return { key: `week-${monday.toISOString().slice(0, 10)}`, start, end: new Date(start.getTime() + 7 * DAY) };
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input)) throw new BadRequestException('Choose a valid month.');
    const start = new Date(`${input}-01T00:00:00+01:00`);
    const [year, month] = input.split('-').map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    return { key: input, start, end: new Date(`${next}-01T00:00:00+01:00`) };
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
      id: String((run as { _id: unknown })._id), period: run.period, frequency: run.frequency,
      periodStart: run.periodStart, periodEnd: run.periodEnd, status: run.status,
      items: run.items, totalKobo: run.totalKobo, createdBy: run.createdBy,
      approvedBy: run.approvedBy, approvedAt: run.approvedAt, paidAt: run.paidAt,
      createdAt: (run as { createdAt?: Date }).createdAt,
    };
  }
}
