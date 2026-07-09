#!/bin/bash
# Ersetze DEIN_TOKEN mit deinem ghp_... Token
TOKEN="${1}"
git push "https://${TOKEN}@github.com/Torben-ListWise/Milchvieh-Data-Assistant.git" HEAD:main
