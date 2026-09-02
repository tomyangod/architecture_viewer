"""领域模型：订单。"""


class Order:
    def __init__(self, order_id: str, amount: float):
        self.order_id = order_id
        self.amount = amount
        self.status = "created"

    def mark_paid(self) -> None:
        self.status = "paid"
