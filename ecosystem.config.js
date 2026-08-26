module.exports = {
  apps: [{
    name: 'kinetic',
    script: 'server.js',
    cwd: '/var/www/kinetic',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '5s',
    restart_delay: 2000,
    exp_backoff_restart_delay: 100,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
