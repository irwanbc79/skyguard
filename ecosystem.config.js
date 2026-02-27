module.exports = {
  apps: [
    {
      name: "skyguard-api",
      script: "./src/app.js",
      instances: "max", // Menggunakan semua core CPU yang tersedia
      exec_mode: "cluster", // Menjalankan dalam mode cluster untuk load balancing
      watch: false, // Matikan watch di production agar tidak restart saat ada file berubah
      max_memory_restart: "2G", // Restart otomatis jika penggunaan RAM melebihi 2GB per instance
      min_uptime: "10s",
      max_restarts: 20,
      exp_backoff_restart_delay: 200,
      listen_timeout: 10000,
      kill_timeout: 5000,
      node_args: "--max-old-space-size=2048",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // Konfigurasi Log
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
