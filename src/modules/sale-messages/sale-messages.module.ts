import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Sale, SaleSchema } from '../sales/sale.schema';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Receipt, ReceiptSchema } from '../receipts/receipt.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { SaleMessage, SaleMessageSchema } from './sale-message.schema';
import { SaleMessagesController, PublicSaleMessagesController } from './sale-messages.controller';
import { SaleMessagesService } from './sale-messages.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SaleMessage.name, schema: SaleMessageSchema },
      { name: Sale.name, schema: SaleSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Receipt.name, schema: ReceiptSchema },
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [SaleMessagesController, PublicSaleMessagesController],
  providers: [SaleMessagesService],
  exports: [SaleMessagesService],
})
export class SaleMessagesModule {}
