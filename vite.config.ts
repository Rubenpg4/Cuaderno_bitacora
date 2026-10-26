import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // React changes less often than the app; its own chunk keeps both below 500 kB.
        manualChunks: (id) =>
          /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined,
      },
    },
  },
});
