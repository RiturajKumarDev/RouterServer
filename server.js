const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store connected clients
let homePC = null;
const mobileClients = new Map(); // socket.id -> {info}
const requestQueue = new Map(); // requestId -> {socket, url, timestamp}

// Statistics
let stats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    startTime: Date.now()
};

// API endpoints for monitoring
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

app.get("/api/history", (req, res) => {
    // Return request history (you can store in database)
    res.json(Array.from(requestQueue.values()));
});

io.on("connection", (socket) => {
    console.log(`📱 Client connected: ${socket.id}`);

    // Home PC registration
    socket.on("register_home", (info) => {
        homePC = {
            socket: socket,
            info: info,
            lastSeen: Date.now()
        };
        console.log(`🏠 Home PC registered: ${info.hostname}`);

        // Notify all mobile clients
        io.emit("home_status", { status: "online", info: info });
    });

    // Mobile client info
    socket.on("register_mobile", (info) => {
        mobileClients.set(socket.id, {
            info: info,
            connectedAt: Date.now()
        });
        console.log(`📱 Mobile client registered: ${info.device || 'Unknown'}`);

        // Send home PC status
        if (homePC) {
            socket.emit("home_status", {
                status: "online",
                info: homePC.info
            });
        }
    });

    // Request internet access
    socket.on("request_internet", (data) => {
        if (!homePC) {
            socket.emit("error", {
                message: "Home PC is not connected"
            });
            return;
        }

        const requestId = `${socket.id}_${Date.now()}`;
        stats.totalRequests++;

        // Store request
        requestQueue.set(requestId, {
            socketId: socket.id,
            url: data.url,
            method: data.method || 'GET',
            timestamp: Date.now()
        });

        console.log(`🌐 Request from ${socket.id}: ${data.url}`);

        // Forward to home PC
        homePC.socket.emit("internet_request", {
            id: requestId,
            url: data.url,
            method: data.method || 'GET',
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
                    error: "Request timeout",
                    requestId: requestId
                });
            }
        }, 60000); // 60 second timeout
    });

    // Internet response from home PC
    socket.on("internet_response", (data) => {
        const requestId = data.id;
        const request = requestQueue.get(requestId);

        if (request) {
            stats.successfulRequests++;
            requestQueue.delete(requestId);

            io.to(request.socketId).emit("internet_result", {
                ...data.result,
                requestId: requestId
            });

            console.log(`✅ Response sent for ${requestId}`);
        }
    });

    // System updates from home PC
    socket.on("system_update", (info) => {
        if (homePC && homePC.socket.id === socket.id) {
            homePC.lastSeen = Date.now();
            homePC.info = { ...homePC.info, ...info };

            // Broadcast to all mobile clients
            io.emit("home_update", info);
        }
    });

    // Disconnect handler
    socket.on("disconnect", () => {
        if (homePC && homePC.socket.id === socket.id) {
            console.log("🏠 Home PC disconnected");
            homePC = null;
            io.emit("home_status", { status: "offline" });
        } else if (mobileClients.has(socket.id)) {
            console.log(`📱 Mobile client disconnected: ${socket.id}`);
            mobileClients.delete(socket.id);
        }
    });
});

// Clean up old requests periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, request] of requestQueue) {
        if (now - request.timestamp > 300000) { // 5 minutes
            requestQueue.delete(id);
        }
    }
}, 60000);

server.listen(3000, () => {
    console.log("☁️ Cloud server running on port 3000");
    console.log(`Local: http://localhost:3000`);
    console.log(`Network: http://${getLocalIP()}:3000`);
});

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}
