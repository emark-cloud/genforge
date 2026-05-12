# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass


@dataclass
class Listing:
    seller: Address
    price: u256
    sold: bool


class Marketplace(gl.Contract):
    listings: TreeMap[str, Listing]

    def __init__(self):
        pass

    @gl.public.write
    def list_item(self, item_id: str, price: int) -> None:
        if item_id in self.listings:
            raise gl.vm.UserError("Already listed")
        self.listings[item_id] = Listing(
            seller=gl.message.sender_address,
            price=u256(price),
            sold=False,
        )

    @gl.public.write
    def buy(self, item_id: str) -> None:
        if item_id not in self.listings:
            raise gl.vm.UserError("Not found")
        listing = self.listings[item_id]
        if listing.sold:
            raise gl.vm.UserError("Already sold")
        self.listings[item_id].sold = True

    @gl.public.view
    def get(self, item_id: str) -> Listing:
        if item_id not in self.listings:
            raise gl.vm.UserError("Not found")
        return self.listings[item_id]
