// PM2 process manager config — used on the VPS
module.exports = {
  apps: [
    {
      name: 'chatapp',
      script: 'src/app.js',
      instances: 'max',       // one per CPU core
      exec_mode: 'cluster',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      // Auto-restart on crash; exponential backoff up to 5 s
      restart_delay: 1000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      // Log rotation (requires pm2-logrotate module)
      error_file: 'logs/err.log',
      out_file:   'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
