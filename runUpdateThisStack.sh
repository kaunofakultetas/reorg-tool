#!/bin/bash



# STEP 1: Create necessary files and directories
# ==============================================
mkdir -p ./_DATA/backend
mkdir -p ./_DATA/fullnodes/{public,private}



# STEP 2: Run the stack
# =====================
# sudo docker network create --subnet=172.18.0.0/24 external
sudo docker-compose down
sudo docker-compose up -d --build



