#!/bin/zsh
cd -- "${0:A:h}" || exit 1
node_bin=$(command -v node)
if [[ -z "$node_bin" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node(N); do
    if [[ -x "$candidate" ]]; then node_bin="$candidate"; fi
  done
fi
if [[ -z "$node_bin" ]]; then
  print 'Install Node.js 22 or later first.'
  read 'reply?Press Enter to exit.'
  exit 1
fi
exec "$node_bin" web/server.cjs --open
