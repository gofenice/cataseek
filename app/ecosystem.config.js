// PM2 process config for production.
// Usage:
//   npm run build            # compile TypeScript → dist/
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup  # survive reboots
module.exports = {
    apps: [
        {
            name: 'cataseek',
            script: 'dist/server.js',
            instances: 1,            // raise to 'max' once you move sessions/cache out of process memory
            exec_mode: 'fork',
            watch: false,
            max_memory_restart: '400M',
            env: {
                NODE_ENV: 'production',
            },
            error_file: 'logs/pm2-error.log',
            out_file: 'logs/pm2-out.log',
            time: true,
        },
    ],
};
