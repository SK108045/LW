import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],
 server:{port:Number(process.env.VITE_PORT||5173),strictPort:true,proxy:{'/api':process.env.VITE_API_TARGET||'http://127.0.0.1:4000'}},
 preview:{proxy:{'/api':process.env.VITE_API_TARGET||'http://127.0.0.1:4000'}},
 build:{target:'es2022',sourcemap:false,rollupOptions:{output:{manualChunks:{react:['react','react-dom','react-dom/client','react-router-dom']}}}}
});
