import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from './order.schema';
import { Sale, SaleSchema } from '../sales/sale.schema';
import { Customer, CustomerSchema } from '../customers/customer.schema';
import { Debt, DebtSchema } from '../debts/debt.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Product, ProductSchema } from '../products/product.schema';
import { Counter, CounterSchema } from '../plans/counter.schema';
import { StockModule } from '../stock/stock.module';
import { SalesModule } from '../sales/sales.module';
import { DebtsModule } from '../debts/debts.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PromotionsModule } from '../promotions/promotions.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Sale.name, schema: SaleSchema },
      { name: Customer.name, schema: CustomerSchema },
      { name: Debt.name, schema: DebtSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
    StockModule,
    SalesModule,
    DebtsModule,
    CustomersModule,
    NotificationsModule,
    PromotionsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
