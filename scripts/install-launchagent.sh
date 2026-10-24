#!/bin/zsh
# Install the background service as a per-user LaunchAgent (macOS only).
set -eu
root="${0:A:h:h}"
node_bin="${NODE_BIN:-$(command -v node || true)}"
[[ -x "$node_bin" ]] || { print 'Node.js 22 or later is required.'; exit 1; }
[[ -f "$root/vendor/line/manifest.json" ]] || { print 'Put the LINE extension in vendor/line first (see README).'; exit 1; }
label=local.line-web-research
data="$HOME/Library/Application Support/line-web-research"
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" && mkdir -p -m 700 "$data"
/bin/launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
/usr/bin/plutil -create xml1 "$plist"
/usr/bin/plutil -insert Label -string "$label" "$plist"
/usr/bin/plutil -insert ProgramArguments -array "$plist"
/usr/bin/plutil -insert ProgramArguments.0 -string "$node_bin" "$plist"
/usr/bin/plutil -insert ProgramArguments.1 -string "$root/web/service.cjs" "$plist"
/usr/bin/plutil -insert WorkingDirectory -string "$root" "$plist"
/usr/bin/plutil -insert RunAtLoad -bool true "$plist"
/usr/bin/plutil -insert KeepAlive -bool true "$plist"
/usr/bin/plutil -insert ProcessType -string Background "$plist"
/usr/bin/plutil -insert ThrottleInterval -integer 10 "$plist"
/usr/bin/plutil -insert Umask -integer 63 "$plist"
/usr/bin/plutil -insert StandardOutPath -string "$data/service.log" "$plist"
/usr/bin/plutil -insert StandardErrorPath -string "$data/service.log" "$plist"
/bin/launchctl enable "gui/$(id -u)/$label"
/bin/launchctl bootstrap "gui/$(id -u)" "$plist"
print "Installed $label: http://127.0.0.1:52426/"
