import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription, SubscriptionDocument } from '../plans/subscription.schema';
import { Plan, PlanDocument } from '../plans/plan.schema';
import { DebtsService } from '../debts/debts.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { bookingReminderEmail } from '../mail/email-templates';
import { paymentFailedEmail } from '../mail/email-templates';
import { ConfigService } from '@nestjs/config';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { SmsService } from '../sms/sms.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Plan.name) private readonly plans: Model<PlanDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Order.name) private readonly ordersModel: Model<OrderDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    private readonly debts: DebtsService,
    private readonly expenses: ExpensesService,
    private readonly receipts: ReceiptsService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappClientService,
    private readonly sms: SmsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'booking-reminders' })
  async bookingReminders(): Promise<void> {
    try {
      const now = new Date();
      const upcoming = await this.bookings.find({
        status: 'confirmed',
        paymentStatus: { $in: ['paid', 'deposit_paid'] },
        reminderSentAt: null,
        startAt: { $gt: now, $lt: new Date(now.getTime() + 48 * 3600000) },
      }).limit(200).exec();
      for (const booking of upcoming) {
        const business = await this.businesses.findById(booking.businessId).lean().exec();
        const hours = business?.bookingSettings?.reminderHoursBefore ?? 24;
        if (booking.startAt.getTime() - now.getTime() > hours * 3600000) continue;
        const when = new Intl.DateTimeFormat('en-NG', {
          timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'short',
          hour: 'numeric', minute: '2-digit',
        }).format(booking.startAt);
        if (booking.customerEmail) {
          const dateLabel = new Intl.DateTimeFormat('en-NG', {
            timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
          }).format(booking.startAt);
          const timeLabel = new Intl.DateTimeFormat('en-NG', {
            timeZone: booking.timezone, hour: 'numeric', minute: '2-digit',
          }).format(booking.startAt);
          const email = bookingReminderEmail({
            customerName: booking.customerName, businessName: business?.name || 'your appointment',
            businessLogo: business?.logoUrl, businessTagline: business?.tagline, businessSlug: business?.slug,
            serviceName: booking.serviceName, providerName: booking.providerName, dateLabel, timeLabel,
            reference: booking.bookingNumber,
            manageUrl: `${this.config.get('appUrl')}/booking/${booking.publicToken}`,
            calendarUrl: `${this.config.get('apiUrl')}/public/bookings/${booking.publicToken}/calendar.ics`,
          });
          await this.mail.send({
            to: booking.customerEmail,
            subject: email.subject,
            html: email.html,
            template: 'booking_reminder',
            businessId: booking.businessId,
          }).catch(() => undefined);
        }
        if (booking.customerPhone) {
          const whatsapp = await this.whatsapp.send({
            businessId: booking.businessId,
            phone: booking.customerPhone,
            text: `Reminder: your ${booking.serviceName} with ${booking.providerName} is ${when}. Manage: ${this.config.get('appUrl')}/booking/${booking.publicToken}`,
          }).catch(() => ({ sent: false }));
          if (!whatsapp.sent && !booking.customerEmail) {
            await this.sms.send({
              to: booking.customerPhone,
              message: `Reminder: ${booking.serviceName} with ${booking.providerName} is ${when}. Ref ${booking.bookingNumber}. ${this.config.get('appUrl')}/booking/${booking.publicToken}`,
            }).catch(() => undefined);
          }
        }
        await this.notifications.create({
          businessId: booking.businessId, type: 'booking',
          title: `Reminder sent · ${booking.bookingNumber}`,
          message: `${booking.customerName} · ${booking.serviceName} · ${when}`,
          tone: 'info', data: { bookingId: booking._id.toString() },
        });
        booking.reminderSentAt = new Date();
        await booking.save();
      }
    } catch (error) {
      this.logger.warn(`Booking reminders failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('*/5 * * * *', { name: 'expire-unpaid-bookings' })
  async expireUnpaidBookings(): Promise<void> {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const expired = await this.bookings.find({
        status: 'pending',
        paymentStatus: 'unpaid',
        source: { $in: ['storefront', 'marketplace'] },
        $or: [
          { paymentExpiresAt: { $lt: now } },
          { paymentExpiresAt: null, createdAt: { $lt: cutoff } },
        ],
      }).select('_id publicToken bookingNumber').lean().exec();

      if (expired.length) {
        const ids = expired.map((b) => b._id);
        await this.bookings.updateMany(
          { _id: { $in: ids } },
          {
            $set: {
              status: 'cancelled',
              cancelledAt: now,
              cancellationReason: 'Payment not completed within checkout window',
            },
            $push: {
              history: {
                status: 'cancelled',
                at: now,
                by: 'system',
                note: 'Abandoned payment expired after 15 minutes',
              },
            },
          },
        ).exec();
        this.logger.log(`Cancelled ${expired.length} expired unpaid booking(s)`);
      }
    } catch (error) {
      this.logger.warn(`Expiring unpaid bookings failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('15 0 * * *', { timeZone: 'Africa/Lagos', name: 'trial-enforcement' })
  async enforceTrials(): Promise<void> {
    try {
      const now = new Date();
      const free = await this.plans.findOne({ isDefault: true }).lean().exec();
      if (!free) return;
      const trials = await this.subscriptions.find({ status: 'trialing' }).limit(500).exec();
      const expiring = [];
      for (const sub of trials) {
        let milestoneReached = Boolean(sub.milestoneReachedAt);
        if (!milestoneReached && sub.trialMilestoneOrders > 0 && sub.trialStartedAt) {
          const count = await this.ordersModel.countDocuments({
            businessId: sub.businessId,
            createdAt: { $gte: sub.trialStartedAt },
          }).exec();
          if (count >= sub.trialMilestoneOrders) {
            sub.milestoneReachedAt = now;
            await sub.save();
            milestoneReached = true;
          }
        }
        if (milestoneReached || (sub.trialEndsAt && sub.trialEndsAt.getTime() <= now.getTime())) {
          expiring.push(sub);
        }
      }
      for (const sub of expiring) {
        await this.subscriptions.updateOne(
          { _id: sub._id },
          {
            $set: {
              planKey: free.key,
              planId: String(free._id),
              status: 'expired',
              adminNote: sub.milestoneReachedAt ? 'Trial usage milestone reached' : 'Trial period ended',
            },
          },
        ).exec();
        await this.notifications.create({
          businessId: sub.businessId,
          type: 'billing',
          title: 'Your trial has ended',
          message: 'Your data is safe. You are now on the free plan — upgrade any time to unlock more products, staff and exports.',
          tone: 'warning',
          data: { planKey: free.key },
          dedupeKey: `trial_ended:${sub.businessId}:${now.toISOString().slice(0, 10)}`,
        });
        const owner = await this.memberships.findOne({ businessId: sub.businessId, role: 'owner' }).lean().exec();
        if (owner) {
          const user = await this.users.findById(owner.userId).lean().exec();
          if (user?.email) {
            const mail = paymentFailedEmail(
              'your business',
              'your Ojaly trial',
              `${this.config.get('appUrl')}/app/settings?tab=billing`,
            );
            void this.mail.send({
              to: user.email,
              subject: 'Your Ojaly trial ended — your data is safe',
              html: mail.html,
              template: 'trial_ended',
              businessId: sub.businessId,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(`Trial enforcement failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('0 7 * * *', { timeZone: 'Africa/Lagos', name: 'debt-reminders' })
  async reminders(): Promise<void> {
    try {
      await this.debts.refreshOverdueStatuses();
      const result = await this.debts.sendScheduledReminders();
      this.logger.log(`Debt reminders sent=${result.sent} failed=${result.failed}`);
    } catch (error) {
      this.logger.error(`Debt reminder job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('5 0 * * *', { timeZone: 'Africa/Lagos', name: 'invoice-statuses' })
  async invoiceStatuses(): Promise<void> {
    try {
      await this.receipts.refreshInvoiceStatuses();
    } catch (error) {
      this.logger.error(`Invoice status job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('*/5 * * * *', { timeZone: 'Africa/Lagos', name: 'recurring-expenses' })
  async recurringExpenses(): Promise<void> {
    try {
      const result = await this.expenses.processRecurring();
      if (result.created) this.logger.log(`Created ${result.created} recurring expense(s)`);
    } catch (error) {
      this.logger.error(`Recurring expense job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  @Cron('*/15 * * * *', { timeZone: 'Africa/Lagos', name: 'webhook-retries' })
  async webhookRetries(): Promise<void> {
    try {
      const result = await this.payments.retryFailedWebhooks();
      if (result.retried) this.logger.log(`Retried ${result.retried} failed webhook(s)`);
    } catch (error) {
      this.logger.error(`Webhook retry job failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
