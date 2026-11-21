import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Customer, CustomerSchema } from '../customers/customer.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { Service, ServiceSchema } from '../services/service.schema';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';
import { PackagePurchase, PackagePurchaseSchema, ServicePackage, ServicePackageSchema } from './package.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServicePackage.name, schema: ServicePackageSchema },
      { name: PackagePurchase.name, schema: PackagePurchaseSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Customer.name, schema: CustomerSchema },
    ]),
    forwardRef(() => PaymentsModule),
    NotificationsModule,
  ],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
