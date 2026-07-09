#!/bin/bash
TOKEN="${1}"
git push "https://${TOKEN}@github.com/Torben-ListWise/Milchvieh-Data-Assistant.git" HEAD:main --force
