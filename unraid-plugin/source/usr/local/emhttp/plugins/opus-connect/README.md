**Opus Connect**

Secure host agent for [Opus Command](https://github.com/Karlmit/Opus-Command).
Lets Opus Command manage its LXC workspaces on this server without SSH access:
instead of holding a root SSH key, Opus Command calls a fixed set of
pre-approved actions on this agent over TLS with an API key. Container names
and project paths are validated server-side.
