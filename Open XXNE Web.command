#!/bin/zsh
cd -- "${0:A:h}" || exit 1
exec "$(/usr/bin/plutil -extract ProgramArguments.0 raw "$HOME/Library/LaunchAgents/local.line-web-research.plist")" web/open-service.cjs
