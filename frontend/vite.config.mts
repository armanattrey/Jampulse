import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins:[tailwindcss()],
  define:{'process.env.NODE_ENV':JSON.stringify('production')},
  resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
  // This is a browser-only bundle; dependency client directives need no server boundary.
  build:{rolldownOptions:{onwarn(warning,defaultHandler){if(warning.code==='MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client'))return;defaultHandler(warning);}},outDir:'assets',emptyOutDir:false,lib:{entry:'src/jam-reel.tsx',formats:['es'],fileName:()=> 'jam-reel.js',cssFileName:'jam-reel'},minify:true}
});
