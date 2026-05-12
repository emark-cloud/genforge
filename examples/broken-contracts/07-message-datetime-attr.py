# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timedelta


class TimedLock(gl.Contract):
    locked_until: str
    owner: Address

    def __init__(self, lock_seconds: u256):
        self.owner = gl.message.sender_address
        # BUG: gl.message has no `datetime` attribute — it's on gl.message_raw.
        now = datetime.fromisoformat(gl.message.datetime)
        self.locked_until = (now + timedelta(seconds=int(lock_seconds))).isoformat()

    @gl.public.view
    def is_locked(self) -> bool:
        # Same bug here.
        now = datetime.fromisoformat(gl.message.datetime)
        return now < datetime.fromisoformat(self.locked_until)
