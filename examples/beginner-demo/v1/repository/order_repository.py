"""存储层：订单仓储。"""

from domain.order import Order


class OrderRepository:
    def __init__(self):
        self._orders = {}

    def save(self, order: Order) -> None:
        self._orders[order.order_id] = order

    def find(self, order_id: str) -> Order:
        return self._orders.get(order_id)
