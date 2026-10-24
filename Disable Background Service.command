#!/bin/zsh
target="gui/$(id -u)/local.line-web-research"
/bin/launchctl disable "$target" || { print 'Could not disable start at login; the service may still be enabled.'; exit 1; }
state=$(/bin/launchctl print "$target" 2>&1)
result=$?
if (( result == 0 )); then
  /bin/launchctl bootout "$target" || { print 'Could not stop the background service; it may still be running.'; exit 1; }
elif [[ "$state" != *'Could not find service'* ]]; then
  print -r -- "$state"
  print 'Could not check the background service state.'
  exit 1
fi
state=$(/bin/launchctl print "$target" 2>&1)
result=$?
if (( result == 0 )) || [[ "$state" != *'Could not find service'* ]]; then
  print 'Could not confirm the service stopped; check launchctl.'
  exit 1
fi
print 'LINE background service stopped and start at login disabled.'
