#!/bin/bash

# Use Railway's PORT or default to 43214
PORT=${PORT:-43214}

echo "Starting server on port $PORT..."
npx next start -p $PORT -H 0.0.0.0
