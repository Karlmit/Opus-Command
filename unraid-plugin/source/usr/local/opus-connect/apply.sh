#!/bin/bash
# apply.sh — run by the webGUI (update.php) after the settings form writes
# opus-connect.cfg. Most settings hot-reload (the agent re-reads config per
# request); a restart is needed for BIND/PORT changes and to honor the
# enable/disable toggle, so just restart unconditionally — it is cheap.

/etc/rc.d/rc.opus-connect restart
