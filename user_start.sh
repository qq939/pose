#!/bin/bash
cd /home/agent/.claude/workspace/project
npm install >> logs/start.log 2>&1
node server.js >> logs/start.log 2>&1 &
echo "YOLO Pose Web App started" >> logs/start.log
