export type Product = { id: string; name: string; price: number };

export async function fetchCatalog(): Promise<Product[]> {
  return [{ id: 'sku-1', name: 'Mug', price: 29 }];
}
