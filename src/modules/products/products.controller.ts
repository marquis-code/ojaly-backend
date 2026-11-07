import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import {
  AddVariantDto,
  CreateProductDto,
  DeleteProductsDto,
  ProductQueryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Permissions(PERMISSIONS.PRODUCTS_READ)
  list(@CurrentBusiness() businessId: string, @Query() query: ProductQueryDto) {
    return this.products.list(businessId, query);
  }

  @Get('categories')
  @Permissions(PERMISSIONS.PRODUCTS_READ)
  categories(@CurrentBusiness() businessId: string) {
    return this.products.categories(businessId);
  }

  @Get('low-stock')
  @Permissions(PERMISSIONS.STOCK_READ)
  lowStock(@CurrentBusiness() businessId: string) {
    return this.products.lowStock(businessId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.PRODUCTS_READ)
  findOne(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.products.findOne(businessId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.products.create(user.id, businessId, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.id, businessId, id, dto);
  }

  @Delete('batch')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  removeMany(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Body() dto: DeleteProductsDto,
  ) {
    return this.products.removeMany(user.id, businessId, dto.ids);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
  ) {
    return this.products.remove(user.id, businessId, id);
  }

  @Post(':id/variants')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  addVariant(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Body() dto: AddVariantDto,
  ) {
    return this.products.addVariant(user.id, businessId, id, dto);
  }

  @Patch(':id/variants/:variantId')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  updateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.products.updateVariant(user.id, businessId, id, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @Permissions(PERMISSIONS.PRODUCTS_WRITE)
  removeVariant(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentBusiness() businessId: string,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ) {
    return this.products.removeVariant(user.id, businessId, id, variantId);
  }
}
