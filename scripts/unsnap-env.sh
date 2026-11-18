#!/usr/bin/env sh
# Run a command with the environment VS Code's snap package injects undone.
#
# The VS Code snap points GTK_PATH, GIO_MODULE_DIR, LOCPATH, etc. at libraries bundled from an
# older Ubuntu (core20). GTK apps launched from its integrated terminal, including Tauri, then
# crash with errors like "undefined symbol: __libc_pthread_init". The snap saves each original
# value as <NAME>_VSCODE_SNAP_ORIG; restore those (unset when empty). Outside the snap this is a no-op.
for orig in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)_VSCODE_SNAP_ORIG=.*/\1/p'); do
  value=$(printenv "${orig}_VSCODE_SNAP_ORIG")
  if [ -n "$value" ]; then export "$orig=$value"; else unset "$orig"; fi
  unset "${orig}_VSCODE_SNAP_ORIG"
done
exec "$@"
