const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const axios = require("axios");

const app = express();

// CORS configuration - Allow all origins (for development)
app.use(cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Store connected clients
let homePC = null;
const mobileClients = new Map(); // socket.id -> {info}
const requestQueue = new Map();   // requestId -> {socket, url, timestamp}

// Statistics
let stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    startTime: Date.now()
};

// ============================================
// 🌐 API ENDPOINTS
// ============================================

// Root route - Health check
app.get("/", (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>🚀 GHAR WALI INTERNET</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; margin: 0; min-height: 100vh; }
            .container { background: rgba(255,255,255,0.95); color: #333; padding: 30px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 600px; margin: 0 auto; }
            h1 { color: #667eea; margin-bottom: 20px; }
            .status { padding: 15px; border-radius: 10px; margin: 20px 0; font-weight: bold; }
            .online { background: #d4edda; color: #155724; }
            .offline { background: #f8d7da; color: #721c24; }
            .stats { display: flex; justify-content: space-around; margin: 30px 0; }
            .stat { background: #f8f9fa; padding: 15px; border-radius: 10px; min-width: 100px; }
            .stat-value { font-size: 24px; font-weight: bold; color: #667eea; }
            .stat-label { font-size: 14px; color: #666; }
            .footer { margin-top: 30px; font-size: 12px; color: #999; }
            .ip-box { background: #e9ecef; padding: 15px; border-radius: 10px; font-family: monospace; word-break: break-all; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏠 GHAR WALI INTERNET ☁️</h1>
            <p>Phone kahi bhi ho - Ghar wali internet use karo!</p>
            
            <div id="homeStatus" class="status offline">⏳ Waiting for Home PC...</div>
            
            <div class="stats">
                <div class="stat">
                    <div class="stat-value" id="totalRequests">0</div>
                    <div class="stat-label">Total Requests</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="successRate">0%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="uptime">0</div>
                    <div class="stat-label">Uptime (hours)</div>
                </div>
            </div>
            
            <div class="ip-box" id="serverIp">
                Server IP: Checking...
            </div>
            
            <p class="footer">🚀 Ghar wali internet - Made with ❤️</p>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const homeStatus = document.getElementById('homeStatus');
            const totalEl = document.getElementById('totalRequests');
            const successEl = document.getElementById('successRate');
            const uptimeEl = document.getElementById('uptime');
            const serverIpEl = document.getElementById('serverIp');
            
            // Get server IP
            fetch('/api/ip').then(r => r.json()).then(data => {
                serverIpEl.textContent = 'Server IP: ' + data.ip;
            });
            
            socket.on('connect', () => {
                console.log('Connected to server');
            });
            
            socket.on('home_status', (data) => {
                if (data.status === 'online') {
                    homeStatus.className = 'status online';
                    homeStatus.innerHTML = '✅ Home PC Connected: ' + (data.info?.hostname || 'Online');
                } else {
                    homeStatus.className = 'status offline';
                    homeStatus.innerHTML = '❌ Home PC Offline';
                }
            });
            
            socket.on('stats_update', (data) => {
                totalEl.textContent = data.totalRequests;
                const rate = data.totalRequests > 0 
                    ? Math.round((data.successfulRequests / data.totalRequests) * 100) 
                    : 0;
                successEl.textContent = rate + '%';
                const hours = Math.floor((Date.now() - data.startTime) / (1000 * 60 * 60));
                uptimeEl.textContent = hours;
            });
            
            // Request stats every 5 seconds
            setInterval(() => {
                fetch('/api/stats').then(r => r.json()).then(data => {
                    if (data.stats) {
                        totalEl.textContent = data.stats.totalRequests;
                        const rate = data.stats.totalRequests > 0 
                            ? Math.round((data.stats.successfulRequests / data.stats.totalRequests) * 100) 
                            : 0;
                        successEl.textContent = rate + '%';
                        const hours = Math.floor((Date.now() - data.stats.startTime) / (1000 * 60 * 60));
                        uptimeEl.textContent = hours;
                    }
                });
            }, 5000);
        </script>
    </body>
    </html>
    `);
});

// Get server IP
app.get("/api/ip", (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let ip = 'Unknown';
    
    Object.keys(interfaces).forEach(key => {
        interfaces[key].forEach(details => {
            if (details.family === 'IPv4' && !details.internal) {
                ip = details.address;
            }
        });
    });
    
    res.json({ ip });
});

// API status endpoint
app.get("/api/status", (req, res) => {
    res.json({
        homePC: homePC ? {
            connected: true,
            info: homePC.info,
            lastSeen: homePC.lastSeen
        } : { connected: false },
        mobileClients: mobileClients.size,
        stats: stats,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000)
    });
});

// Get stats
app.get("/api/stats", (req, res) => {
    res.json({ stats });
});

// ============================================
// 🚀 DIRECT PROXY - Server apne internet se request karega
// ============================================
app.all("/proxy/*", async (req, res) => {
    try {
        const targetUrl = req.url.replace("/proxy/", "");
        
        if (!targetUrl.startsWith("http")) {
            return res.status(400).json({ error: "Invalid URL" });
        }
        
        console.log(`🌍 Direct Proxy: ${req.method} ${targetUrl}`);
        stats.totalRequests++;
        
        const startTime = Date.now();
        
        // Forward headers (remove host)
        const headers = { ...req.headers };
        delete headers.host;
        
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: headers,
            data: req.body,
            timeout: 30000,
            maxContentLength: 50 * 1024 * 1024, // 50MB
            validateStatus: () => true
        });
        
        const responseTime = Date.now() - startTime;
        
        if (response.status >= 200 && response.status < 400) {
            stats.successfulRequests++;
        } else {
            stats.failedRequests++;
        }
        
        // Send response
        res.status(response.status);
        
        // Copy headers
        Object.keys(response.headers).forEach(key => {
            if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
                res.setHeader(key, response.headers[key]);
            }
        });
        
        res.send(response.data);
        
        console.log(`✅ Proxy response: ${response.status} (${responseTime}ms)`);
        
    } catch (error) {
        console.error("Proxy error:", error.message);
        stats.failedRequests++;
        res.status(500).json({ 
            error: error.message,
            message: "Ghar wali internet proxy error"
        });
    }
});

// ============================================
// 🔌 SOCKET.IO SETUP
// ============================================
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ["polling", "websocket"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e8
});

io.on("connection", (socket) => {
    console.log("📱 Client connected:", socket.id);
    console.log("📊 Total clients:", io.engine.clientsCount);
    
    // ========================================
    // 🏠 HOME PC EVENTS
    // ========================================
    
    // Register Home PC
    socket.on("register_home", (data) => {
        homePC = {
            socket: socket,
            info: data || { hostname: "Home PC" },
            lastSeen: Date.now()
        };
        console.log("🏠 Home PC registered:", data?.hostname || socket.id);
        
        socket.emit("home_registered", { 
            status: "success",
            message: "Ghar wala PC connected!"
        });
        
        // Broadcast to all mobile clients
        io.emit("home_status", { 
            status: "online",
            info: homePC.info
        });
        
        // Send stats update
        io.emit("stats_update", stats);
    });
    
    // System update from Home PC
    socket.on("system_update", (info) => {
        if (homePC && homePC.socket.id === socket.id) {
            homePC.lastSeen = Date.now();
            homePC.info = { ...homePC.info, ...info };
            io.emit("home_update", info);
        }
    });
    
    // ========================================
    // 📱 MOBILE CLIENT EVENTS
    // ========================================
    
    // Register Mobile client
    socket.on("register_mobile", (data) => {
        mobileClients.set(socket.id, {
            info: data,
            connectedAt: Date.now()
        });
        console.log("📱 Mobile registered:", data?.device || "Unknown");
        
        // Send home status
        if (homePC) {
            socket.emit("home_status", { 
                status: "online",
                info: homePC.info
            });
        }
        
        // Send proxy info
        socket.emit("proxy_config", {
            direct: `${req.protocol}://${req.get('host')}/proxy/`,
            socket: "socket.io"
        });
    });
    
    // ========================================
    // 🌐 INTERNET REQUESTS (via Home PC)
    // ========================================
    
    // Request internet (via Home PC)
    socket.on("request_internet", (data) => {
        if (!homePC) {
            socket.emit("error", { 
                message: "Ghar wala PC online nahi hai",
                code: "HOME_PC_OFFLINE"
            });
            return;
        }
        
        const requestId = `${socket.id}_${Date.now()}`;
        stats.totalRequests++;
        
        requestQueue.set(requestId, {
            socketId: socket.id,
            url: data.url,
            method: data.method || "GET",
            timestamp: Date.now()
        });
        
        console.log(`🌐 Request from ${socket.id}: ${data.url}`);
        
        // Forward to Home PC
        homePC.socket.emit("internet_request", {
            id: requestId,
            url: data.url,
            method: data.method || "GET",
            headers: data.headers || {},
            body: data.body,
            timeout: data.timeout || 30
        });
        
        // Set timeout
        setTimeout(() => {
            if (requestQueue.has(requestId)) {
                requestQueue.delete(requestId);
                stats.failedRequests++;
                socket.emit("internet_result", {
                    error: "Request timeout - Ghar wala PC slow hai",
                    requestId: requestId
                });
                io.emit("stats_update", stats);
            }
        }, (data.timeout || 30) * 1000 + 5000);
    });
    
    // Internet response from Home PC
    socket.on("internet_response", (data) => {
        const requestId = data.id;
        const request = requestQueue.get(requestId);
        
        if (request) {
            stats.successfulRequests++;
            requestQueue.delete(requestId);
            
            io.to(request.socketId).emit("internet_result", {
                ...data.result,
                requestId: requestId,
                from: "ghar_wala_pc"
            });
            
            console.log(`✅ Response sent for ${requestId}`);
            io.emit("stats_update", stats);
        }
    });
    
    // ========================================
    // 📊 UTILITY EVENTS
    // ========================================
    
    // Ping
    socket.on("ping", (data) => {
        socket.emit("pong", { 
            time: Date.now(),
            serverTime: new Date().toISOString()
        });
    });
    
    // Get status
    socket.on("get_status", () => {
        socket.emit("status", {
            homePC: !!homePC,
            mobileClients: mobileClients.size,
            stats: stats
        });
    });
    
    // ========================================
    // ❌ DISCONNECT HANDLER
    // ========================================
    
    socket.on("disconnect", (reason) => {
        console.log("❌ Client disconnected:", socket.id, "Reason:", reason);
        
        // Remove from collections
        mobileClients.delete(socket.id);
        
        // If Home PC disconnected
        if (homePC && homePC.socket.id === socket.id) {
            homePC = null;
            console.log("🏠 Home PC disconnected");
            io.emit("home_status", { status: "offline" });
        }
        
        console.log("📊 Remaining clients:", io.engine.clientsCount);
        io.emit("stats_update", stats);
    });
    
    socket.on("error", (error) => {
        console.error("⚠️ Socket error:", error);
    });
});

// Clean up old requests periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, request] of requestQueue) {
        if (now - request.timestamp > 300000) { // 5 minutes
            requestQueue.delete(id);
            stats.failedRequests++;
        }
    }
}, 60000);

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("SIGTERM received, closing server...");
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

process.on("SIGINT", () => {
    console.log("SIGINT received, closing server...");
    server.close(() => {
        console.log("Server closed");
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log("☁️ ==================================");
    console.log("☁️ GHAR WALI INTERNET SERVER READY!");
    console.log("☁️ ==================================");
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌍 Render URL: https://routerserver-0vog.onrender.com`);
    console.log(`🏠 Direct Proxy: /proxy/`);
    console.log(`📱 Socket.IO: active`);
    console.log("☁️ ==================================");
});
