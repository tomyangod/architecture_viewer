// Coffee Shop frontend entry — demo only
export function placeOrder(sku, qty) {
  return fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, qty })
  });
}
