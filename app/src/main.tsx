import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { TRPCProvider } from '@/providers/trpc'
import { initBackendPort } from '@/lib/backend'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  // 必须在渲染前确定后端动态端口，否则 trpc/aiService 会连到错误的 3000 端口
  await initBackendPort();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <TRPCProvider>
          <App />
        </TRPCProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

bootstrap();
