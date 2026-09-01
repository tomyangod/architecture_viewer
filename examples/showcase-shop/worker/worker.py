"""Async worker: brew jobs + outbound notifications."""


class BrewWorker:
    def consume(self, message: dict) -> None:
        order_id = message.get("order_id")
        self.notify(order_id)

    def notify(self, order_id: str) -> None:
        # call external notify channel
        pass


if __name__ == "__main__":
    BrewWorker()
