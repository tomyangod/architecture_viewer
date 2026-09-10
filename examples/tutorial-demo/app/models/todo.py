"""domain 层：待办实体。"""
from dataclasses import dataclass


@dataclass
class Todo:
    id: int
    title: str
    done: bool = False

    def to_dict(self):
        return {"id": self.id, "title": self.title, "done": self.done}

    @classmethod
    def from_row(cls, row):
        return cls(id=row["id"], title=row["title"], done=bool(row["done"]))
