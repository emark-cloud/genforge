# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class Vault(gl.Contract):
    owner: Address
    locked: bool

    def __init__(self):
        self.owner = gl.message.sender_address
        self.locked = True

    @gl.public.write
    def unlock(self, caller: Address) -> None:
        if caller == self.owner:
            self.locked = False
        else:
            raise gl.vm.UserError("Not the owner")

    @gl.public.write
    def lock(self) -> None:
        if gl.message.sender_address == self.owner:
            self.locked = True
        else:
            raise gl.vm.UserError("Not the owner")

    @gl.public.view
    def is_locked(self) -> bool:
        return self.locked
