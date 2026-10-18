import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' lets the built site open from any folder or GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
