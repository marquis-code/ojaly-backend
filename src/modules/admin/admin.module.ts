import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../users/user.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Membership, MembershipSchema } from '../memberships/membership.schema';
import { Plan, PlanSchema } from '../plans/plan.schema';
import { Subscription, SubscriptionSchema } from '../plans/subscription.schema';
import { Coupon, CouponSchema } from '../plans/coupon.schema';
import { PromotionsModule } from '../promotions/promotions.module';
import { RiskModule } from '../risk/risk.module';
import { Payment, PaymentSchema } from '../payments/payment.schema';
import { WebhookEvent, WebhookEventSchema } from '../payments/webhook-event.schema';
import { WhatsappMessage, WhatsappMessageSchema } from '../whatsapp/whatsapp-message.schema';
import { WhatsappContact, WhatsappContactSchema } from '../whatsapp/whatsapp-contact.schema';
import { AuditLog, AuditLogSchema } from '../audit/audit-log.schema';
import { Product, ProductSchema } from '../products/product.schema';
import { Order, OrderSchema } from '../orders/order.schema';
import { Sale, SaleSchema } from '../sales/sale.schema';
import { RefreshSession, RefreshSessionSchema } from '../auth/refresh-session.schema';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';
import { SupportNote, SupportNoteSchema } from './support-note.schema';
import { AdminExportsService } from './admin-exports.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Membership.name, schema: MembershipSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
      { name: WhatsappMessage.name, schema: WhatsappMessageSchema },
      { name: WhatsappContact.name, schema: WhatsappContactSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Sale.name, schema: SaleSchema },
      { name: RefreshSession.name, schema: RefreshSessionSchema },
      { name: SupportNote.name, schema: SupportNoteSchema },
    ]),
    PaymentsModule,
    PromotionsModule,
    RiskModule,
    NotificationsModule,
    AffiliatesModule,
    JwtModule.register({}),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminExportsService],
})
export class AdminModule {}
