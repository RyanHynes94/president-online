# President (online)

3-6 players, lobby + 4-letter room code, no bots. Server holds all hands and only sends each player their own cards.

## Run locally
    npm install && npm start     # http://localhost:3000

## Deploy on Render (free tier)
1. Push this folder to a GitHub repo.
2. Render dashboard > New > Web Service > pick the repo (or New > Blueprint to use render.yaml).
3. Build command `npm install`, start command `npm start`, instance type Free.
4. Open the .onrender.com URL, create a room, share the invite link.
Free instances sleep after a period of inactivity, so the first visit can take up to a minute to wake. Room state lives in memory, so a restart or redeploy clears all rooms.

## Deploy on Fly.io (always on, small monthly cost)
    fly launch      # accept the detected Node app, set internal port 3000
    fly deploy
Set `min_machines_running = 1` and `auto_stop_machines = false` in fly.toml to avoid sleeping.

## Rules
Ranks low to high: 3 4 5 6 7 8 9 10 J Q K A 2. Play the same number of cards as the pile at equal or higher rank; lead any set. A 2 clears the pile. First out is President, last is Scum. Next round, Scum swaps best card for President's worst (automatic). Disconnected players are auto-played after 15 seconds and can rejoin on the same device.
