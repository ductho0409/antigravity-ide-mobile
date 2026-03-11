module.exports = {
  apps: [{
    name: 'antigravity-mobile',
    script: 'server/dist/index.js',
    cwd: '/Users/admin/Downloads/Antigraviti mobile/antigravity-ide-mobile',
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
      PORT: '3333'
    },
    // Auto-restart on crash
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    // Logging
    error_file: '/Users/admin/Downloads/Antigraviti mobile/antigravity-ide-mobile/data/pm2-error.log',
    out_file: '/Users/admin/Downloads/Antigraviti mobile/antigravity-ide-mobile/data/pm2-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // Watch for file changes (optional, disabled for stability)
    watch: false
  }]
};
