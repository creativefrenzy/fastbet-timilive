# fastbet-timilive → Node.js (Express) Port

This project ports your PHP endpoint to a secure, production-ready Express.js service.

## Quick Start
1. **Install Node 18+**.
2. `cp .env.example .env` and set your DB credentials and `APP_KEY`.
3. `npm install`
4. For PM2

a. Install PM2 Globally
If PM2 isn’t installed yet:
`npm install -g pm2`

b. Start Your App with PM2
From your project directory (e.g. /var/www/html/node-bet)
`cd /var/www/html/node-bet`
`pm2 start src/index.js --name "node-bet" --node-args="--env-file=.env"`

 If Node.js v20+ then
`pm2 start src/index.js --name "fastbet-timilive"``

Explanation:
  src/index.js → entry file of your app
  --name "node-bet" → gives your process a readable name
  --node-args="--env-file=.env" → loads your environment variables

c. Make It Restart Automatically on System Boot
  `pm2 startup systemd`
  It will print something like:

sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu

  Copy and run the exact command it outputs.
d. Save the Current PM2 Process List
  `pm2 save`

e. Verify Auto-Start Works
  `sudo reboot`
  After reboot, check:
  `sudo pm2 ls`



