const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const { SocksProxyAgent } = require('socks-proxy-agent');
const axios = require('axios');

const app = express();

// CORS configuration
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 🌐 SOCKS5 Proxy Configuration
let homeClient = null;
let socksProxy = null;

// Store active proxy sessions
const proxySessions = new Map();

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔥 PROXY ENDPOINTS - Phone direct internet access through PC

// HTTP/HTTPS Proxy endpoint
app.all('/proxy/*', async (req, res) => {
  try {
    if (!homeClient) {
      return res.status(503).json({ error: 'Home PC not connected' });
    }

    // Extract target URL from path
    const targetUrl = req.url.replace('/proxy/', '');
    if (!targetUrl.startsWith('http')) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`🌍 Proxy request: ${req.method} ${targetUrl}`);

    // Generate unique request ID
    const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Store response promise
    const responsePromise = new Promise((resolve, reject) => {
      proxySessions.set(requestId, { resolve, reject, res: res });
      
      // Set timeout
      setTimeout(() => {
        if (proxySessions.has(requestId)) {
          proxySessions.delete(requestId);
          reject(new Error('Proxy request timeout'));
          res.status(504).json({ error: 'Proxy timeout' });
        }
      }, 30000);
    });

    // Forward request to Home PC
    homeClient.emit("proxy_request", {
      id: requestId,
      url: targetUrl,
      method: req.method,
      headers: req.headers,
      body: req.body,
      query: req.query
    });

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// SOCKS5 Proxy handshake endpoint
app.post('/socks/connect', (req, res) => {
  try {
    if (!homeClient) {
      return res.status(503).json({ error: 'Home PC not connected' });
    }

    const { host, port, username, password } = req.body;
    
    // Generate SOCKS session ID
    const sessionId = `${socket.id}_${Date.now()}`;
    
    console.log(`🔌 SOCKS connect request: ${host}:${port}`);

    homeClient.emit("socks_connect", {
      sessionId: sessionId,
      host: host,
      port: port,
      auth: { username, password }
    });

    res.json({ 
      sessionId: sessionId,
      status: 'connecting',
      proxy: `socks5://${host}:${port}`
    });

  } catch (error) {
    console.error('SOCKS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8
});

io.on("connection", (socket) => {
  console.log("📱 Client connected:", socket.id);

  // Register Home PC
  socket.on("register_home", (data) => {
    homeClient = socket;
    console.log("🏠 Home PC registered:", socket.id);
    
    // Create SOCKS proxy agent for this connection
    const proxyConfig = {
      host: 'localhost',  // Will be forwarded through socket
      port: 1080,         // SOCKS default port
      protocol: 'socks5'
    };
    
    socket.emit("home_registered", { 
      status: "success",
      proxy: proxyConfig,
      message: "Home PC ready for proxy"
    });
    
    io.emit("home_status", { 
      status: "online",
      info: data || { hostname: "Home PC" }
    });
  });

  // Register Mobile client
  socket.on("register_mobile", (data) => {
    console.log("📱 Mobile registered:", socket.id, data?.device || "unknown");
    
    if (homeClient) {
      socket.emit("home_status", { 
        status: "online",
        info: { hostname: "Home PC" }
      });
      
      // Send proxy configuration to mobile
      socket.emit("proxy_config", {
        socks5: `socks5://${process.env.RENDER_EXTERNAL_URL || 'localhost'}:${PORT}`,
        http: `${process.env.RENDER_EXTERNAL_URL || 'localhost'}:${PORT}/proxy/`,
        ws: `wss://${process.env.RENDER_EXTERNAL_URL || 'localhost'}:${PORT}`
      });
    }
  });

  // Handle internet requests (original)
  socket.on("request_internet", (data) => {
    if (!homeClient) {
      socket.emit("error", { message: "Home PC not connected" });
      return;
    }

    console.log(`🌐 Request from ${socket.id}: ${data.url}`);
    
    const requestId = `${socket.id}_${Date.now()}`;
    
    homeClient.emit("internet_request", {
      id: requestId,
      url: data.url,
      method: data.method || 'GET',
      headers: data.headers || {},
      body: data.body,
      timeout: data.timeout || 30
    });
  });

  // Handle internet response
  socket.on("internet_response", (data) => {
    console.log(`📦 Response for: ${data.id}`);
    io.to(data.id).emit("internet_result", data.result);
  });

  // 🔥 NEW: Handle proxy responses from Home PC
  socket.on("proxy_response", (data) => {
    const session = proxySessions.get(data.id);
    if (session) {
      const { resolve, res } = session;
      
      // Send response back to original HTTP request
      if (res && !res.headersSent) {
        res.status(data.status || 200);
        
        if (data.headers) {
          Object.keys(data.headers).forEach(key => {
            res.setHeader(key, data.headers[key]);
          });
        }
        
        res.send(data.body);
      }
      
      proxySessions.delete(data.id);
    }
  });

  // 🔥 NEW: Handle SOCKS data
  socket.on("socks_data", (data) => {
    const session = proxySessions.get(data.sessionId);
    if (session && session.socket) {
      session.socket.write(Buffer.from(data.data, 'base64'));
    }
  });

  // Handle disconnect
  socket.on("disconnect", (reason) => {
    console.log("❌ Client disconnected:", socket.id, reason);
    
    if (homeClient && homeClient.id === socket.id) {
      homeClient = null;
      console.log("🏠 Home PC disconnected");
      io.emit("home_status", { status: "offline" });
      
      // Clear all proxy sessions
      proxySessions.clear();
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    homePC: homeClient ? 'connected' : 'disconnected',
    proxySessions: proxySessions.size
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => process.exit(0));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`☁️ Router Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🔗 Render URL: ${process.env.RENDER_EXTERNAL_URL || 'Not set'}`);
  console.log(`🌐 Proxy endpoint: /proxy/*`);
  console.log(`🔌 SOCKS5 available: Yes`);
  console.log(`🏠 Home PC: ${homeClient ? 'connected' : 'waiting'}`);
});
