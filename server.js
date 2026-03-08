const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path"); // Add this

const app = express();
app.use(cors());
app.use(express.json());

// Serve a simple homepage (optional - to avoid "Cannot GET /")
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // For development - restrict in production
    methods: ["GET", "POST"]
  }
});

// Your existing socket.io code
let homeClient = null;

io.on("connection", (socket) => {
  console.log("📱 Client connected:", socket.id);
  
  socket.on("register_home", () => {
    homeClient = socket;
    console.log("🏠 Home PC registered");
  });
  
  socket.on("request_internet", (data) => {
    if (homeClient) {
      homeClient.emit("internet_request", {
        id: socket.id,
        url: data.url,
        method: data.method || 'GET',
        headers: data.headers || {},
        body: data.body
      });
    }
  });
  
  socket.on("internet_response", (data) => {
    io.to(data.id).emit("internet_result", data.result);
  });
});

// IMPORTANT: Use PORT from environment variable (Render sets this automatically)
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {  // '0.0.0.0' is important for Render
  console.log(`☁️ Cloud server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
});
