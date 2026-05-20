module.exports = {
  apps: [{
    name: "traininglab",
    script: "node_modules/.bin/next",
    args: "start",
    cwd: "/var/www/traininglab",
    env: {
      NODE_ENV: "production",
      PORT: "3000",
    },
    max_memory_restart: "512M",
    // Restart automatically if app crashes
    autorestart: true,
    watch: false,
    // Zero-downtime reload: keep old instance up until new one is ready
    wait_ready: true,
    listen_timeout: 10000,
  }]
};
