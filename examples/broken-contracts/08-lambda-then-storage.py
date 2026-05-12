# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *


class HashRegistry(gl.Contract):
    # Stores who has registered which payload hash.
    registered: TreeMap[Address, bytes]

    def __init__(self):
        pass

    @gl.public.write
    def register(self, payload: bytes) -> None:
        sender = gl.message.sender_address
        if sender in self.registered:
            raise gl.vm.UserError("Already registered")
        # BUG: passing an inline lambda to gl.eq_principle.strict_eq taints
        # the entire `register` method as "inside nondet" per lint's
        # call-graph analysis (E025 / E026). The subsequent storage write
        # below then trips E026.
        digest = gl.eq_principle.strict_eq(
            lambda: gl.nondet.hash.keccak256(payload)
        ).get()
        self.registered[sender] = digest
