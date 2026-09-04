import type { Product } from '../catalog/catalog-api';

const lines: Product[] = [];

export function addToCart(product: Product): void {
  lines.push(product);
}

export function cartTotal(): number {
  return lines.reduce((sum, item) => sum + item.price, 0);
}
