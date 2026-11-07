import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RequestContextModule } from './common/context/request-context.service';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';
import { TenantGuard } from './common/guards/tenant.guard';
import { PermissionsGuard, PlatformRolesGuard, RolesGuard } from './common/guards/authorization.guards';
import { Membership, MembershipSchema } from './modules/memberships/membership.schema';
import { Business, BusinessSchema } from './modules/businesses/business.schema';
import { AuthModule } from './modules/auth/auth.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { ProductsModule } from './modules/products/products.module';
import { ServicesModule } from './modules/services/services.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SmsModule } from './modules/sms/sms.module';
import { PackagesModule } from './modules/packages/packages.module';
import { CampusModule } from './modules/campus/campus.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { AiModule } from './modules/ai/ai.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { CustomRequestsModule } from './modules/custom-requests/custom-requests.module';
import { BookingMessagesModule } from './modules/booking-messages/booking-messages.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { SupportModule } from './modules/support/support.module';
import { StockModule } from './modules/stock/stock.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SalesModule } from './modules/sales/sales.module';
import { CustomersModule } from './modules/customers/customers.module';
import { DebtsModule } from './modules/debts/debts.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { BuilderModule } from './modules/builder/builder.module';
import { PlansModule } from './modules/plans/plans.module';
import { AdminModule } from './modules/admin/admin.module';
import { AffiliatesModule } from './modules/affiliates/affiliates.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { WhatsappClientModule } from './modules/whatsapp/whatsapp-client.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MailModule } from './modules/mail/mail.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      load: [configuration],
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodbUri'),
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 20,
      }),
    }),
    MongooseModule.forFeature([
      { name: Membership.name, schema: MembershipSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
    JwtModule.register({}),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 240 }]),
    RequestContextModule,
    MailModule,
    AuditModule,
    PlansModule,
    WhatsappClientModule,
    AffiliatesModule,
    AuthModule,
    BusinessesModule,
    ProductsModule,
    ServicesModule,
    ProvidersModule,
    BookingsModule,
    WaitlistModule,
    ReviewsModule,
    SmsModule,
    PackagesModule,
    CampusModule,
    CalendarModule,
    AiModule,
    MarketplaceModule,
    CustomRequestsModule,
    BookingMessagesModule,
    PayrollModule,
    PromotionsModule,
    SupportModule,
    StockModule,
    CustomersModule,
    DebtsModule,
    ReceiptsModule,
    SalesModule,
    OrdersModule,
    ExpensesModule,
    ReportsModule,
    NotificationsModule,
    PaymentsModule,
    BuilderModule,
    StorefrontModule,
    SummariesModule,
    WhatsappModule,
    UploadsModule,
    AdminModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
